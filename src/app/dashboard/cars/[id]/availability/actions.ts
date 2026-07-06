"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { eachDateInRange } from "@/lib/calendar";

export async function toggleAvailability(
  carId: string,
  dateIso: string,
  makeAvailable: boolean
): Promise<void> {
  const supabase = await createClient();

  if (makeAvailable) {
    await supabase.from("car_availability").insert({ car_id: carId, date: dateIso });
  } else {
    await supabase
      .from("car_availability")
      .delete()
      .eq("car_id", carId)
      .eq("date", dateIso);
  }

  revalidatePath(`/dashboard/cars/${carId}/availability`);
  revalidatePath(`/auta/${carId}`);
}

export async function addAvailabilityRange(
  carId: string,
  startIso: string,
  endIso: string
): Promise<void> {
  const supabase = await createClient();
  const rows = eachDateInRange(startIso, endIso).map((date) => ({ car_id: carId, date }));

  await supabase
    .from("car_availability")
    .upsert(rows, { onConflict: "car_id,date", ignoreDuplicates: true });

  revalidatePath(`/dashboard/cars/${carId}/availability`);
  revalidatePath(`/auta/${carId}`);
}

export async function removeAvailabilityRange(
  carId: string,
  startIso: string,
  endIso: string
): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("car_availability")
    .delete()
    .eq("car_id", carId)
    .gte("date", startIso)
    .lte("date", endIso);

  revalidatePath(`/dashboard/cars/${carId}/availability`);
  revalidatePath(`/auta/${carId}`);
}
