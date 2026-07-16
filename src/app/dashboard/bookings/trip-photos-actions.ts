"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FuelLevel, TripPhotoStage } from "@/types/database";

export async function addTripPhoto(
  bookingId: string,
  stage: TripPhotoStage,
  storagePath: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("trip_photos").insert({
    booking_id: bookingId,
    uploader_id: user.id,
    stage,
    storage_path: storagePath,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
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
    return { error: error.message };
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

  const { error } = await supabase.from("trip_photos").delete().eq("id", photoId);
  if (error) {
    return { error: error.message };
  }
  await supabase.storage.from("trip-photos").remove([storagePath]);

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
