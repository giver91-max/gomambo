"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerificationStatus } from "@/lib/verification-gate";
import { getPartnerContext, partnerCanList } from "@/lib/partner";
import { parseCarDocumentsForm, parseCarListingForm } from "@/lib/car-form";
import type { CarDraftResult, CarFormState } from "@/app/dashboard/cars/actions";

/**
 * An admin adding a car FOR someone — a rental company that sent its fleet
 * as a list, or an owner who asked for help. Rafał's call (2026-11-07): "if
 * someone has a fleet we add the cars for them, it encourages cooperation".
 *
 * The car belongs to the owner exactly as if they had added it themselves:
 * owner_id is theirs, a company's car carries its partner_id (and so never
 * auto-confirms), and the photos and policy end up in THEIR Storage folder,
 * so they can edit and delete them later like any of their own. What the
 * admin does not get is a way around the listing gates: a company must be
 * active, a private owner verified — the same rules as createCarDraft. The
 * admin is the reviewer here, so the car is approved on the spot instead of
 * waiting in the queue the admin would only clear a minute later.
 *
 * The browser uploads into the ADMIN's own folder (the only one Storage lets
 * it write to) and attach moves the files across with the service role.
 * Uploading through this action instead would hit Vercel's ~4.5MB body cap,
 * as explained in dashboard/cars/actions.ts.
 */

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  // Checked here, not left to /admin's middleware: a server action is a POST
  // anyone can send to any page.
  if (profile?.role !== "admin") throw new Error("Brak uprawnień.");
  return user.id;
}

/** The same two gates createCarDraft applies, worded for the admin. */
async function listingGate(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string
): Promise<{ partnerId: string | null; error: string | null }> {
  const { data: owner } = await admin.from("profiles").select("id").eq("id", ownerId).maybeSingle();
  if (!owner) return { partnerId: null, error: "Nie ma takiego użytkownika." };

  const partner = await getPartnerContext(admin, ownerId);
  if (partner) {
    if (!partnerCanList(partner.status)) {
      return {
        partnerId: null,
        error: `Wypożyczalnia „${partner.tradeName}” nie jest aktywna — zweryfikuj ją najpierw w zakładce Wypożyczalnie.`,
      };
    }
    return { partnerId: partner.partnerId, error: null };
  }

  const { status } = await getVerificationStatus(admin, ownerId);
  if (status !== "approved") {
    return {
      partnerId: null,
      error:
        "Ten użytkownik nie ma zatwierdzonej weryfikacji tożsamości. Auto osoby prywatnej można dodać dopiero po niej — a firma musi najpierw założyć wypożyczalnię w panelu „Firma”.",
    };
  }
  return { partnerId: null, error: null };
}

export async function adminCreateCarDraft(
  ownerId: string,
  _prevState: CarFormState,
  formData: FormData
): Promise<CarDraftResult> {
  await requireAdmin();
  const admin = createAdminClient();

  const gate = await listingGate(admin, ownerId);
  if (gate.error) return { error: gate.error };

  const parsed = parseCarListingForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  // The statement is the owner's; the admin ticks it having had it from them
  // (the form says so), the same as entering their plate.
  const docs = parseCarDocumentsForm(formData, { rentalRightAlreadyConfirmed: false });
  if (!docs.ok) return { error: docs.error };

  // Service role: cars_insert_own only lets a session insert its OWN car.
  // Still a draft — it becomes approved in adminAttachCarImages, once it has
  // photos and a policy, so a failed upload never leaves an empty listing live.
  const { data: car, error: carError } = await admin
    .from("cars")
    .insert({
      owner_id: ownerId,
      ...(gate.partnerId ? { partner_id: gate.partnerId, instant_book: false } : {}),
      ...parsed.fields,
      status: "pending",
    })
    .select("id")
    .single();
  if (carError || !car) {
    return { error: carError?.message ?? "Nie udało się zapisać auta." };
  }

  const { error: privateError } = await admin
    .from("car_private")
    .upsert({
      car_id: car.id,
      registration_number: parsed.registrationNumber,
      ...docs.documents,
      rental_right_confirmed_at: new Date().toISOString(),
    });
  if (privateError) {
    await admin.from("cars").delete().eq("id", car.id);
    return { error: `Nie udało się zapisać numeru rejestracyjnego (${privateError.message}).` };
  }

  return { error: null, carId: car.id };
}

/** Undo a draft whose uploads failed. Only ever an unpublished one. */
export async function adminDeleteCarDraft(carId: string): Promise<void> {
  await requireAdmin();
  await createAdminClient().from("cars").delete().eq("id", carId).eq("status", "pending");
}

export async function adminAttachCarImages(
  ownerId: string,
  carId: string,
  images: { path: string; position: number }[],
  insuranceDocumentPath: string
): Promise<{ error: string | null }> {
  const adminId = await requireAdmin();
  const admin = createAdminClient();

  if (images.length === 0) return { error: "Dodaj przynajmniej jedno zdjęcie auta." };
  if (images.length > 8) return { error: "Maksymalnie 8 zdjęć." };
  if (!insuranceDocumentPath) return { error: "Dodaj polisę OC." };

  const { data: car } = await admin
    .from("cars")
    .select("owner_id, status, brand, model")
    .eq("id", carId)
    .maybeSingle();
  if (!car || car.owner_id !== ownerId || car.status !== "pending") {
    return { error: "Nie znaleziono szkicu tego auta." };
  }

  // Only files this admin just uploaded for THIS car may be moved — the
  // paths come from the browser, and the service role could otherwise be
  // pointed at anyone's photos.
  const fromPrefix = `${adminId}/${carId}/`;
  const allPaths = [...images.map((i) => i.path), insuranceDocumentPath];
  if (allPaths.some((p) => !p.startsWith(fromPrefix) || p.includes("..") || p.slice(fromPrefix.length).includes("/"))) {
    return { error: "Nieprawidłowa ścieżka pliku. Odśwież stronę i spróbuj ponownie." };
  }
  const moveTarget = (path: string) => `${ownerId}/${carId}/${path.slice(fromPrefix.length)}`;

  const moved: { bucket: string; path: string }[] = [];
  const moveAll = async (bucket: string, paths: string[]): Promise<string | null> => {
    for (const path of paths) {
      const to = moveTarget(path);
      if (to === path) continue; // the admin adding a car on their own account
      const { error } = await admin.storage.from(bucket).move(path, to);
      if (error) return error.message;
      moved.push({ bucket, path: to });
    }
    return null;
  };

  const moveError =
    (await moveAll("car-images", images.map((i) => i.path))) ??
    (await moveAll("car-insurance", [insuranceDocumentPath]));

  const rollback = async (message: string) => {
    for (const bucket of ["car-images", "car-insurance"]) {
      const paths = moved.filter((m) => m.bucket === bucket).map((m) => m.path);
      if (paths.length > 0) await admin.storage.from(bucket).remove(paths);
    }
    await admin.storage.from("car-images").remove(images.map((i) => i.path));
    await admin.storage.from("car-insurance").remove([insuranceDocumentPath]);
    await admin.from("cars").delete().eq("id", carId).eq("status", "pending");
    return { error: message };
  };

  if (moveError) return rollback(`Nie udało się przenieść plików (${moveError}). Dodaj auto jeszcze raz.`);

  const { error: imagesError } = await admin.from("car_images").insert(
    images.map(({ path, position }) => ({
      car_id: carId,
      storage_path: moveTarget(path),
      position,
    }))
  );
  if (imagesError) return rollback(`Nie udało się zapisać zdjęć (${imagesError.message}).`);

  const { error: insuranceError } = await admin
    .from("car_private")
    .upsert({ car_id: carId, insurance_document_path: moveTarget(insuranceDocumentPath) });
  if (insuranceError) return rollback(`Nie udało się zapisać polisy (${insuranceError.message}).`);

  // Read back: the catalogue invariant (0042) pauses a company's car while
  // the company is not active, and that must not be reported as published.
  const { data: published, error: approveError } = await admin
    .from("cars")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", carId)
    .select("status")
    .single();
  let status = published?.status ?? null;
  if (approveError) {
    // A failed response is not proof the update failed — the write may have
    // landed and only the answer been lost. Ask again before deciding, or a
    // retry by the admin would list the same car twice.
    const { data: recheck } = await admin.from("cars").select("status").eq("id", carId).maybeSingle();
    status = recheck?.status ?? null;
    if (status === "pending") {
      return rollback(`Nie udało się zatwierdzić auta (${approveError.message}). Nic nie zostało zapisane — dodaj je jeszcze raz.`);
    }
    if (status === null) {
      return {
        error: `Nie udało się potwierdzić zapisu auta (${approveError.message}). Zanim dodasz je ponownie, sprawdź listę aut właściciela.`,
      };
    }
  }
  if (status !== "approved") {
    return {
      error:
        "Auto zapisane, ale wypożyczalnia nie jest aktywna, więc zostało wstrzymane. Wróci do katalogu po aktywacji firmy.",
    };
  }

  revalidatePath("/admin/cars");
  revalidatePath("/admin");
  revalidatePath(`/admin/users/${ownerId}`);
  redirect(`/admin/cars/new?owner=${ownerId}&added=${carId}`);
}
