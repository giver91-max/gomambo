"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FuelLevel, TripPhotoStage } from "@/types/database";

// PostgREST's own text is English and meant for a developer ("new row
// violates row-level security policy…"): logged, never shown.
function tripPhotoError(error: { code?: string; message?: string } | null, fallback: string, context: string): string {
  console.error(`[trip-photos] ${context}`, { code: error?.code, message: error?.message });
  return fallback;
}

export async function addTripPhoto(
  bookingId: string,
  stage: TripPhotoStage,
  storagePath: string
): Promise<{ error: string | null; photoId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The new row's id goes back to the manager: a photo added in the same
  // visit used to be removed by its storage path, which matched no row.
  const { data: inserted, error } = await supabase
    .from("trip_photos")
    .insert({
      booking_id: bookingId,
      uploader_id: user.id,
      stage,
      storage_path: storagePath,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { error: tripPhotoError(error, "Nie udało się zapisać zdjęcia. Spróbuj ponownie.", "addTripPhoto failed") };
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null, photoId: inserted.id };
}

export async function updateTripCondition(
  bookingId: string,
  stage: TripPhotoStage,
  odometerKm: number | null,
  fuelLevel: FuelLevel | null
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("bookings")
    .update(
      stage === "pickup"
        ? { pickup_odometer_km: odometerKm, pickup_fuel_level: fuelLevel }
        : { return_odometer_km: odometerKm, return_fuel_level: fuelLevel }
    )
    .eq("id", bookingId);

  if (error) {
    return { error: tripPhotoError(error, "Nie udało się zapisać stanu auta. Spróbuj ponownie.", "updateTripCondition failed") };
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}

export async function removeTripPhoto(
  photoId: string,
  storagePath: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The row first, and the file only once a row is really gone: RLS on
  // trip_photos lets only the uploader (or an admin) delete, and a refused
  // delete returns no error, just no rows — so this action never removes the
  // file of a photo that remains. It is not a guarantee for the file itself:
  // the storage policy trip_photos_storage_delete_own_or_admin (0022) lets
  // ANY participant of the booking delete any object under <booking_id>/
  // straight through the Storage API, without this action. Closing that needs
  // a migration (delete only by the object's owner_id or an admin).
  const { data: deleted, error } = await supabase
    .from("trip_photos")
    .delete()
    .eq("id", photoId)
    .eq("storage_path", storagePath)
    .select("id");
  if (error || !deleted?.length) {
    return { error: tripPhotoError(error, "Nie udało się usunąć zdjęcia. Odśwież stronę i spróbuj ponownie.", "removeTripPhoto failed") };
  }
  await supabase.storage.from("trip-photos").remove([storagePath]);

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
