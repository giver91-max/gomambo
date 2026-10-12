"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/notify-admins";
import type { Car } from "@/types/database";

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
      .select("owner_id, status, rejection_reason, partner_id, partners(status)")
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
        rejection_reason: string | null;
        partner_id: string | null;
        partners: { status: string } | null;
      },
      isAdmin,
    };
  }

  return { supabase, user, car, isAdmin };
}

// Any edit by the owner to an APPROVED or a REJECTED car sends it back to
// "pending" for an admin to look at.
//
// Approved: the new content has not been reviewed. Rejected: the rejection
// e-mail tells the owner "Popraw ogłoszenie i wyślij je do ponownej
// weryfikacji" — but until now there was no way to do that. An owner edit
// left the car "rejected" (the DB trigger pins status for owners) and told no
// one, so a corrected listing stayed dead until an admin happened to reopen it.
//
// Owners can't set status themselves (see enforce_car_update_rules) — only the
// service-role client can. Admins editing a car are themselves the reviewer,
// so their edits don't trigger a review.
//
// The revert is conditional on the row still holding the status we read, and
// only the request that actually performs it announces it. Several photo
// uploads in a row each call this; without the condition every one of them
// would have sent the admins another e-mail about the same car.
const REVIEWABLE_STATUSES = ["approved", "rejected"] as const;
type ReviewableStatus = (typeof REVIEWABLE_STATUSES)[number];

function sendsBackToReview(status: string, isAdmin: boolean): status is ReviewableStatus {
  return !isAdmin && (REVIEWABLE_STATUSES as readonly string[]).includes(status);
}

async function sendBackToReview(
  carId: string,
  car: { status: string; rejection_reason: string | null },
  isAdmin: boolean,
  what: string
) {
  if (!sendsBackToReview(car.status, isAdmin)) return;
  const admin = createAdminClient();
  const { data: reverted } = await admin
    .from("cars")
    .update({ status: "pending", rejection_reason: null })
    .eq("id", carId)
    .eq("status", car.status)
    .select("id");
  if (reverted && reverted.length > 0) {
    await announceBackInReview(admin, carId, what, car.status, car.rejection_reason);
  }
}

// A car that goes back to "pending" needs an admin, and until now nobody was
// told: no queue entry, no e-mail. An approved one vanished from the site; a
// corrected rejected one never came back at all.
async function announceBackInReview(
  admin: ReturnType<typeof createAdminClient>,
  carId: string,
  what: string,
  from: ReviewableStatus,
  previousRejectionReason: string | null
) {
  const { data: car } = await admin
    .from("cars")
    .select("brand, model, year, city, owner_id")
    .eq("id", carId)
    .single();
  if (!car) return;
  const [{ data: owner }, { data: authUser }] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", car.owner_id).single(),
    admin.auth.admin.getUserById(car.owner_id),
  ]);
  const ownerEmail = authUser?.user?.email;
  const ownerName = owner?.full_name || ownerEmail || "nieznany";

  const wasRejected = from === "rejected";
  await notifyAdmins(admin, {
    queue: {
      type: "new_car_pending",
      body: wasRejected
        ? `Poprawione po odrzuceniu (${what}): ${car.brand} ${car.model} — ${ownerName}`
        : `Auto wróciło do weryfikacji po edycji (${what}): ${car.brand} ${car.model} — ${ownerName}`,
    },
    link: "/admin/cars",
    email: {
      subject: wasRejected
        ? `Poprawione auto do weryfikacji: ${car.brand} ${car.model}`
        : `Auto do ponownej weryfikacji: ${car.brand} ${car.model}`,
      intro: wasRejected
        ? `Właściciel poprawił odrzucone ogłoszenie (${what}) i czeka na Twoją ponowną decyzję.`
        : `Właściciel zmienił zatwierdzone ogłoszenie (${what}). Zniknęło ze strony i wróci, gdy je ponownie zatwierdzisz.`,
      rows: [
        ["Auto", `${car.brand} ${car.model} (${car.year})`],
        ["Miasto", car.city],
        ["Co się zmieniło", what],
        ["Wcześniejszy powód odrzucenia", wasRejected ? previousRejectionReason : null],
        ["Właściciel", ownerName],
        ["E-mail", ownerEmail],
      ],
      cta: "Sprawdź zmiany",
    },
  });
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

  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = Number(formData.get("year"));
  const pricePerDay = Number(formData.get("price_per_day"));
  const city = String(formData.get("city") ?? "").trim();
  const registrationNumber = String(formData.get("registration_number") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const vehicleType = String(formData.get("vehicle_type") ?? "").trim();
  const fuelType = String(formData.get("fuel_type") ?? "").trim();
  const transmission = String(formData.get("transmission") ?? "").trim();
  const seats = Number(formData.get("seats"));
  const mileageLimitRaw = String(formData.get("mileage_limit_km") ?? "").trim();
  const mileageLimit = mileageLimitRaw ? Number(mileageLimitRaw) : null;
  const mileageOverageFeeRaw = String(formData.get("mileage_overage_fee_per_km") ?? "").trim();
  const mileageOverageFee = mileageOverageFeeRaw ? Number(mileageOverageFeeRaw) : null;
  const fuelPolicy = String(formData.get("fuel_policy") ?? "full_to_full").trim();
  const securityDepositRaw = String(formData.get("security_deposit_amount") ?? "").trim();
  const securityDeposit = securityDepositRaw ? Number(securityDepositRaw) : null;
  const pricePerMonthRaw = String(formData.get("price_per_month") ?? "").trim();
  const pricePerMonth = pricePerMonthRaw ? Number(pricePerMonthRaw) : null;
  const deliveryAvailable = formData.get("delivery_available") === "true";
  const deliveryInfo = String(formData.get("delivery_info") ?? "").trim();
  const cancellationPolicy = String(formData.get("cancellation_policy") ?? "moderate").trim();

  if (!brand || !model || !city) {
    return { error: "Wypełnij markę, model i miasto." };
  }
  if (!registrationNumber) {
    return { error: "Podaj numer rejestracyjny." };
  }
  if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
    return { error: "Podaj prawidłowy rok produkcji." };
  }
  if (!(pricePerDay > 0)) {
    return { error: "Cena za dzień musi być większa od zera." };
  }
  if (!vehicleType || !fuelType || !transmission) {
    return { error: "Wybierz typ pojazdu, rodzaj paliwa i skrzynię biegów." };
  }
  if (!Number.isInteger(seats) || seats < 1 || seats > 9) {
    return { error: "Podaj prawidłową liczbę miejsc (1–9)." };
  }
  if (mileageLimit !== null && !(mileageLimit > 0)) {
    return { error: "Limit kilometrów musi być większy od zera." };
  }
  if (mileageOverageFee !== null && mileageOverageFee < 0) {
    return { error: "Opłata za km ponad limit nie może być ujemna." };
  }
  if (securityDeposit !== null && securityDeposit < 0) {
    return { error: "Kaucja nie może być ujemna." };
  }
  if (pricePerMonth !== null && !(pricePerMonth > 0)) {
    return { error: "Cena za miesiąc musi być większa od zera." };
  }

  const admin = createAdminClient();
  const previousStatus = car.status;
  const backToReview = sendsBackToReview(previousStatus, isAdmin);
  const { error } = await admin
    .from("cars")
    .update({
      brand,
      model,
      year,
      price_per_day: pricePerDay,
      city,
      description: description || null,
      vehicle_type: vehicleType as Car["vehicle_type"],
      fuel_type: fuelType as Car["fuel_type"],
      transmission: transmission as Car["transmission"],
      seats,
      mileage_limit_km: mileageLimit,
      mileage_overage_fee_per_km: mileageOverageFee,
      fuel_policy: fuelPolicy as Car["fuel_policy"],
      security_deposit_amount: securityDeposit,
      price_per_month: pricePerMonth,
      delivery_available: deliveryAvailable,
      delivery_info: deliveryAvailable && deliveryInfo ? deliveryInfo : null,
      cancellation_policy: cancellationPolicy as Car["cancellation_policy"],
      ...(backToReview ? { status: "pending", rejection_reason: null } : {}),
    })
    .eq("id", carId);

  if (error) {
    return { error: error.message };
  }

  if (backToReview) {
    await announceBackInReview(
      admin,
      carId,
      "zmienione dane ogłoszenia",
      previousStatus,
      car.rejection_reason
    );
  }

  // Plate is kept out of the public listing row (see 0037).
  const { error: privateError } = await admin
    .from("car_private")
    .upsert({ car_id: carId, registration_number: registrationNumber || null });
  if (privateError) {
    return { error: privateError.message };
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

  await sendBackToReview(carId, car, isAdmin, "nowy dokument OC");

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

  await sendBackToReview(carId, car, isAdmin, "dodane zdjęcie");

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

  await sendBackToReview(carId, car, isAdmin, "usunięte zdjęcie");

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
    const { error } = await supabase.from("cars").update({ status: nextStatus }).eq("id", carId);
    if (error) {
      failed.push({ carId, error: error.message });
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
// client needed, unlike sendBackToReview above).
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
  const { error } = await supabase.from("cars").update({ status: nextStatus }).eq("id", carId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/auta/${carId}`);
  return { error: null };
}
