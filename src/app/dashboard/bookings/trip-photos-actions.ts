"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TripPhotoStage } from "@/types/database";

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
