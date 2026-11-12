"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import {
  carDocumentsExpired,
  DOCUMENTS_EXPIRED_REASON,
  ownerListingGate,
  parseCarDocumentsForm,
  parseCarListingForm,
} from "@/lib/car-form";

export type EditCarState = { error: string | null; success?: boolean };

async function requireOwnedCar(carId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: car }, { data: profile }] = await Promise.all([
    supabase
      .from("cars")
      .select("owner_id, status, partner_id, partners(status)")
      .eq("id", carId)
      .single(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);
  const isAdmin = profile?.role === "admin";

  if (!car || (car.owner_id !== user.id && !isAdmin)) {
    return {
      supabase,
      user,
      car: null as null | {
        owner_id: string;
        status: string;
        partner_id: string | null;
        partners: { status: string } | null;
      },
      isAdmin,
    };
  }

  return { supabase, user, car, isAdmin };
}

// Any edit to an already-approved car (details, photos) reverts it to
// "pending" so an admin re-reviews the new content. Owners can't set status
// themselves (see enforce_car_update_rules trigger) — only the admin client
// can, and only because auth.uid() is null for service-role calls. Admins
// editing a car are themselves the reviewer, so their edits don't need
// re-review and the status is left untouched.
//
// "Approved" includes 'paused': the owner can resume a paused car on their
// own (toggleCarPause), so editing it while paused and resuming used to put
// unreviewed content straight back into the catalogue.
async function revertToPendingIfApproved(carId: string, wasApproved: boolean, isAdmin: boolean) {
  if (!wasApproved || isAdmin) return;
  const admin = createAdminClient();
  await admin.from("cars").update({ status: "pending", rejection_reason: null }).eq("id", carId);
}

export async function updateCarDetails(
  carId: string,
  _prevState: EditCarState,
  formData: FormData
): Promise<EditCarState> {
  const { user, car, isAdmin } = await requireOwnedCar(carId);
  if (!user) redirect("/login");
  if (!car) {
    return { error: "Nie masz dostępu do tego ogłoszenia." };
  }

  const parsed = parseCarListingForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }
  const { fields, registrationNumber } = parsed;
  // An admin editing their OWN car is its owner here: they give the dates and
  // the rental-right statement like anyone else.
  const actingAsAdmin = isAdmin && car.owner_id !== user.id;

  const admin = createAdminClient();

  // Owners give the OC / inspection dates on every save, so cars listed
  // before 0051 get them the first time they are edited. An admin fixing a
  // typo in someone's listing may not know them, so for the admin they are
  // checked only when filled in — and the rental-right statement is never
  // the admin's to make here.
  const { data: currentPrivate } = await admin
    .from("car_private")
    .select("rental_right_confirmed_at, insurance_valid_until, inspection_valid_until, registration_number")
    .eq("car_id", carId)
    .maybeSingle();
  const postedInsurance = String(formData.get("insurance_valid_until") ?? "").trim();
  const postedInspection = String(formData.get("inspection_valid_until") ?? "").trim();
  // For the admin: only dates they actually changed. The form is prefilled,
  // so "given" would otherwise be true for every car with dates — and an
  // expired one would block the admin from saving anything at all.
  const adminChangedDocs =
    (!!postedInsurance && postedInsurance !== (currentPrivate?.insurance_valid_until ?? "")) ||
    (!!postedInspection && postedInspection !== (currentPrivate?.inspection_valid_until ?? ""));
  let documentUpdate: Record<string, string> = {};
  if (!actingAsAdmin || adminChangedDocs) {
    const docs = parseCarDocumentsForm(formData, {
      rentalRightAlreadyConfirmed: actingAsAdmin || !!currentPrivate?.rental_right_confirmed_at,
    });
    if (!docs.ok) return { error: docs.error };
    documentUpdate = {
      ...docs.documents,
      ...(docs.rentalRightConfirmedNow ? { rental_right_confirmed_at: new Date().toISOString() } : {}),
    };
  }

  const wasApproved = car.status === "approved" || car.status === "paused";
  const writePrivate = () =>
    admin
      .from("car_private")
      // The plate is kept out of the public listing row (see 0037).
      .upsert({ car_id: carId, registration_number: registrationNumber || null, ...documentUpdate });
  const writeCar = () =>
    admin
      .from("cars")
      .update({
        ...fields,
        ...(wasApproved && !isAdmin ? { status: "pending", rejection_reason: null } : {}),
      })
      .eq("id", carId)
      .select("status, rejection_reason")
      .single();

  // The order matters, and differs. An owner's edit sends the car back to
  // review in the cars update, so that goes FIRST: new dates must never land
  // while the car is still live — a save that then failed would have left a
  // published car with dates nobody checked. An admin's edit (their own car
  // included) keeps the status, so the expired-documents invariant (0051)
  // fires on it and must already see the dates entered in this save:
  // car_private goes first, and is put back if the car update fails.
  if (!isAdmin) {
    const { error } = await writeCar();
    if (error) return { error: error.message };
    const { error: privateError } = await writePrivate();
    if (privateError) return { error: privateError.message };
  } else {
    const { error: privateError } = await writePrivate();
    if (privateError) return { error: privateError.message };
    const { data: saved, error } = await writeCar();
    if (error) {
      if (currentPrivate) {
        await admin
          .from("car_private")
          .update({
            registration_number: currentPrivate.registration_number,
            insurance_valid_until: currentPrivate.insurance_valid_until,
            inspection_valid_until: currentPrivate.inspection_valid_until,
            rental_right_confirmed_at: currentPrivate.rental_right_confirmed_at,
          })
          .eq("car_id", carId);
      }
      return { error: error.message };
    }
    if (wasApproved && saved?.status === "paused" && saved.rejection_reason === DOCUMENTS_EXPIRED_REASON) {
      revalidatePath(`/dashboard/cars/${carId}/edit`);
      return {
        error:
          "Zapisano, ale auto zostało wstrzymane: data ważności OC lub przeglądu już minęła. Wpisz aktualną datę, żeby je przywrócić.",
      };
    }
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/cars/${carId}/edit`);
  revalidatePath(`/auta/${carId}`);
  return { error: null, success: true };
}

export async function setCarInsuranceDocument(
  carId: string,
  path: string
): Promise<{ error: string | null }> {
  const { supabase, user, car, isAdmin } = await requireOwnedCar(carId);
  if (!user) redirect("/login");
  if (!car) {
    return { error: "Nie masz dostępu do tego ogłoszenia." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("car_private")
    .select("insurance_document_path")
    .eq("car_id", carId)
    .maybeSingle();

  const { error } = await admin
    .from("car_private")
    .upsert({ car_id: carId, insurance_document_path: path });

  if (error) {
    return { error: error.message };
  }

  if (existing?.insurance_document_path && existing.insurance_document_path !== path) {
    await supabase.storage.from("car-insurance").remove([existing.insurance_document_path]);
  }

  await revertToPendingIfApproved(carId, car.status === "approved" || car.status === "paused", isAdmin);

  revalidatePath(`/dashboard/cars/${carId}/edit`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function addCarPhoto(
  carId: string,
  path: string,
  position: number
): Promise<{ error: string | null }> {
  const { supabase, user, car, isAdmin } = await requireOwnedCar(carId);
  if (!user) redirect("/login");
  if (!car) {
    return { error: "Nie masz dostępu do tego ogłoszenia." };
  }

  const { error } = await supabase
    .from("car_images")
    .insert({ car_id: carId, storage_path: path, position });

  if (error) {
    return { error: error.message };
  }

  await revertToPendingIfApproved(carId, car.status === "approved" || car.status === "paused", isAdmin);

  revalidatePath(`/dashboard/cars/${carId}/edit`);
  revalidatePath(`/auta/${carId}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function removeCarPhoto(
  carId: string,
  imageId: string,
  storagePath: string
): Promise<{ error: string | null }> {
  const { supabase, user, car, isAdmin } = await requireOwnedCar(carId);
  if (!user) redirect("/login");
  if (!car) {
    return { error: "Nie masz dostępu do tego ogłoszenia." };
  }

  await supabase.storage.from("car-images").remove([storagePath]);

  const { error } = await supabase.from("car_images").delete().eq("id", imageId);
  if (error) {
    return { error: error.message };
  }

  await revertToPendingIfApproved(carId, car.status === "approved" || car.status === "paused", isAdmin);

  revalidatePath(`/dashboard/cars/${carId}/edit`);
  revalidatePath(`/auta/${carId}`);
  revalidatePath("/dashboard");
  return { error: null };
}

// Shared by the single-car delete button (which redirects afterward) and
// bulkDeleteCars (which doesn't — redirecting mid-loop makes no sense for
// a multi-car operation, so that caller just aggregates results instead).
async function deleteCarCore(carId: string): Promise<{ error: string | null }> {
  const { supabase, user, car } = await requireOwnedCar(carId);
  if (!user) redirect("/login");
  if (!car) {
    return { error: "Nie masz dostępu do tego ogłoszenia." };
  }

  const { data: images } = await supabase
    .from("car_images")
    .select("storage_path")
    .eq("car_id", carId);

  if (images && images.length > 0) {
    await supabase.storage.from("car-images").remove(images.map((i) => i.storage_path));
  }

  const { error } = await supabase.from("cars").delete().eq("id", carId);
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

export async function deleteCar(
  carId: string,
  redirectTo: string = "/dashboard"
): Promise<{ error: string | null }> {
  const result = await deleteCarCore(carId);
  if (result.error) {
    return result;
  }

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/admin/cars");
  redirect(redirectTo);
}

export async function bulkDeleteCars(
  carIds: string[]
): Promise<{ succeeded: string[]; failed: { carId: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { carId: string; error: string }[] = [];

  for (const carId of carIds) {
    const result = await deleteCarCore(carId);
    if (result.error) {
      failed.push({ carId, error: result.error });
    } else {
      succeeded.push(carId);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/kalendarz");
  return { succeeded, failed };
}

export async function bulkSetCarStatus(
  carIds: string[],
  nextStatus: "approved" | "paused"
): Promise<{ succeeded: string[]; failed: { carId: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { carId: string; error: string }[] = [];

  for (const carId of carIds) {
    const { supabase, car } = await requireOwnedCar(carId);
    if (!car) {
      failed.push({ carId, error: "Nie masz dostępu do tego ogłoszenia." });
      continue;
    }
    if (car.status !== "approved" && car.status !== "paused") {
      failed.push({ carId, error: "Można wstrzymać lub wznowić tylko zatwierdzone ogłoszenie." });
      continue;
    }
    if (car.status === nextStatus) {
      succeeded.push(carId);
      continue;
    }
    if (nextStatus === "approved" && car.partner_id && car.partners?.status !== "active") {
      failed.push({
        carId,
        error: "Wypożyczalnia nie jest aktywna — auta wrócą do katalogu po weryfikacji.",
      });
      continue;
    }
    if (nextStatus === "approved" && (await carDocumentsExpired(supabase, carId))) {
      failed.push({ carId, error: "Nie można wznowić: polisa OC lub badanie techniczne wygasło. Dodaj aktualny dokument i datę w edycji auta — ogłoszenie wróci wtedy do weryfikacji." });
      continue;
    }
    const { data: updated, error } = await supabase
      .from("cars")
      .update({ status: nextStatus })
      .eq("id", carId)
      .select("status")
      .maybeSingle();
    if (error) {
      failed.push({ carId, error: error.message });
    } else if (updated?.status !== nextStatus) {
      // A database invariant (inactive company, expired documents) kept it paused.
      failed.push({ carId, error: "Nie udało się wznowić ogłoszenia — sprawdź dokumenty auta." });
    } else {
      succeeded.push(carId);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/kalendarz");
  return { succeeded, failed };
}

// Toggling between "approved" and "paused" is the one status change the
// enforce_car_update_rules trigger lets an owner make directly (no admin
// client needed, unlike revertToPendingIfApproved above).
export async function toggleCarPause(carId: string): Promise<{ error: string | null }> {
  const { supabase, car } = await requireOwnedCar(carId);
  if (!car) {
    return { error: "Nie masz dostępu do tego ogłoszenia." };
  }
  if (car.status !== "approved" && car.status !== "paused") {
    return { error: "Można wstrzymać lub wznowić tylko zatwierdzone ogłoszenie." };
  }

  const nextStatus = car.status === "approved" ? "paused" : "approved";
  // The database refuses to publish a car whose company is not active
  // (enforce_car_update_rules, 0042), so without this the resume would
  // silently do nothing and still report success.
  if (nextStatus === "approved" && car.partner_id && car.partners?.status !== "active") {
    return {
      error:
        "Twoja wypożyczalnia nie jest w tej chwili aktywna w GoMambo — auta wrócą do katalogu po weryfikacji.",
    };
  }
  if (nextStatus === "approved" && (await carDocumentsExpired(supabase, carId))) {
    return { error: "Nie można wznowić: polisa OC lub badanie techniczne wygasło. Dodaj aktualny dokument i datę w edycji auta — ogłoszenie wróci wtedy do weryfikacji." };
  }
  const { data: updated, error } = await supabase
    .from("cars")
    .update({ status: nextStatus })
    .eq("id", carId)
    .select("status")
    .maybeSingle();
  if (error) {
    return { error: error.message };
  }
  // Read back: the invariants in enforce_car_update_rules can keep the car
  // paused without an error, and "resumed" must not be reported then.
  if (updated?.status !== nextStatus) {
    return { error: "Nie udało się wznowić ogłoszenia — sprawdź dokumenty auta." };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/auta/${carId}`);
  return { error: null };
}

// A rejected car used to be a dead end: the owner fixed what the e-mail asked
// for, the listing stayed "Odrzucone", and nobody at GoMambo knew anything
// had changed — the only way out was deleting it and starting over. This
// puts it back in the queue and tells the admin, the same way a new car does.
export async function resubmitRejectedCar(carId: string): Promise<{ error: string | null }> {
  const { supabase, user, car } = await requireOwnedCar(carId);
  if (!car || car.owner_id !== user.id) {
    return { error: "Nie znaleziono auta." };
  }
  if (car.status !== "rejected") {
    return { error: "To auto nie jest odrzucone — nie trzeba go wysyłać ponownie." };
  }

  const gate = await ownerListingGate(supabase, user.id);
  if (gate.error) return { error: gate.error };

  const [{ count: photoCount }, { data: carPrivate }, { data: details }] = await Promise.all([
    supabase.from("car_images").select("id", { count: "exact", head: true }).eq("car_id", carId),
    supabase.from("car_private").select("insurance_document_path").eq("car_id", carId).maybeSingle(),
    supabase.from("cars").select("brand, model, year, city").eq("id", carId).single(),
  ]);
  if (!photoCount) return { error: "Dodaj przynajmniej jedno zdjęcie auta." };
  if (!carPrivate?.insurance_document_path) return { error: "Dodaj polisę OC." };

  // Service role: owners cannot move their own car's status (see
  // enforce_car_update_rules), and that is what keeps moderation meaningful.
  const admin = createAdminClient();
  // Read back: only the call that actually moves the car out of 'rejected'
  // may tell the admin. Parallel clicks — or an admin approving it at the
  // same moment — would otherwise each send a notification and an e-mail.
  const { data: moved, error } = await admin
    .from("cars")
    .update({ status: "pending", rejection_reason: null })
    .eq("id", carId)
    .eq("status", "rejected")
    .select("id");
  if (error) return { error: error.message };
  if (!moved?.length) return { error: "To auto nie jest już odrzucone — odśwież stronę." };

  const carLabel = details ? `${details.brand} ${details.model} (${details.year})` : "auto";
  const ownerName = String(user.user_metadata?.full_name ?? user.email ?? "nieznany");
  await admin.from("admin_notifications").insert({
    type: "new_car_pending",
    body: `Poprawione auto do ponownej weryfikacji: ${carLabel} — ${ownerName}`,
    link: "/admin/cars",
  });
  await sendNotificationEmail({
    to: "auto@gomambo.pl",
    subject: `Poprawione auto do weryfikacji: ${details?.brand ?? ""} ${details?.model ?? ""}`.trim(),
    html: `
      <p>Właściciel poprawił odrzucone auto i wysłał je do ponownej weryfikacji.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
        <li><strong>Miasto:</strong> ${escapeHtml(details?.city ?? "")}</li>
        <li><strong>Właściciel:</strong> ${escapeHtml(ownerName)} (${escapeHtml(user.email ?? "")})</li>
      </ul>
      <p><a href="https://www.gomambo.pl/admin/cars">Przejdź do panelu admina</a></p>
    `,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/cars/${carId}/edit`);
  revalidatePath("/admin/cars");
  return { error: null };
}
