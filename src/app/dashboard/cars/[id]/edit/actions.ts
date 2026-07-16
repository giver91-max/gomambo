"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
    supabase.from("cars").select("owner_id, status").eq("id", carId).single(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);
  const isAdmin = profile?.role === "admin";

  if (!car || (car.owner_id !== user.id && !isAdmin)) {
    return {
      supabase,
      user,
      car: null as null | { owner_id: string; status: string },
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
  if (pricePerMonth !== null && !(pricePerMonth > 0)) {
    return { error: "Cena za miesiąc musi być większa od zera." };
  }

  const admin = createAdminClient();
  const wasApproved = car.status === "approved";
  const { error } = await admin
    .from("cars")
    .update({
      brand,
      model,
      year,
      price_per_day: pricePerDay,
      city,
      registration_number: registrationNumber,
      description: description || null,
      vehicle_type: vehicleType as Car["vehicle_type"],
      fuel_type: fuelType as Car["fuel_type"],
      transmission: transmission as Car["transmission"],
      seats,
      mileage_limit_km: mileageLimit,
      mileage_overage_fee_per_km: mileageOverageFee,
      fuel_policy: fuelPolicy as Car["fuel_policy"],
      price_per_month: pricePerMonth,
      delivery_available: deliveryAvailable,
      delivery_info: deliveryAvailable && deliveryInfo ? deliveryInfo : null,
      cancellation_policy: cancellationPolicy as Car["cancellation_policy"],
      ...(wasApproved && !isAdmin ? { status: "pending", rejection_reason: null } : {}),
    })
    .eq("id", carId);

  if (error) {
    return { error: error.message };
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

  const { data: existing } = await supabase
    .from("cars")
    .select("insurance_document_path")
    .eq("id", carId)
    .single();

  const { error } = await supabase
    .from("cars")
    .update({ insurance_document_path: path })
    .eq("id", carId);

  if (error) {
    return { error: error.message };
  }

  if (existing?.insurance_document_path && existing.insurance_document_path !== path) {
    await supabase.storage.from("car-insurance").remove([existing.insurance_document_path]);
  }

  await revertToPendingIfApproved(carId, car.status === "approved", isAdmin);

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

  await revertToPendingIfApproved(carId, car.status === "approved", isAdmin);

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

  await revertToPendingIfApproved(carId, car.status === "approved", isAdmin);

  revalidatePath(`/dashboard/cars/${carId}/edit`);
  revalidatePath(`/auta/${carId}`);
  revalidatePath("/dashboard");
  return { error: null };
}

export async function deleteCar(
  carId: string,
  redirectTo: string = "/dashboard"
): Promise<{ error: string | null }> {
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

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/admin/cars");
  redirect(redirectTo);
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
  const { error } = await supabase.from("cars").update({ status: nextStatus }).eq("id", carId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/auta/${carId}`);
  return { error: null };
}
