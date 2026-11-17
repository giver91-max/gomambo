"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { eachDateInRange } from "@/lib/calendar";
import { carWriteErrorMessage } from "@/lib/car-form";

export type AvailabilityResult = { error: string | null };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAVE_FAILED = "Nie udało się zapisać dostępności. Spróbuj ponownie.";

/**
 * The session and the car checked before writing. These used to be skipped
 * and the write's result ignored: with an expired session RLS silently wrote
 * nothing, and the calendar still showed the days as saved.
 */
async function ownCarForAvailability(carId: string, startIso: string, endIso: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: "Sesja wygasła. Zaloguj się ponownie i zaznacz dni jeszcze raz." };
  }
  if (!ISO_DATE_RE.test(startIso) || !ISO_DATE_RE.test(endIso) || startIso > endIso) {
    return { supabase, error: "Nieprawidłowy zakres dat. Odśwież stronę i spróbuj ponownie." };
  }
  const { data: car } = await supabase.from("cars").select("owner_id").eq("id", carId).maybeSingle();
  if (!car || car.owner_id !== user.id) {
    return { supabase, error: "Nie masz dostępu do tego auta." };
  }
  return { supabase, error: null };
}

export async function addAvailabilityRange(
  carId: string,
  startIso: string,
  endIso: string
): Promise<AvailabilityResult> {
  const { supabase, error: accessError } = await ownCarForAvailability(carId, startIso, endIso);
  if (accessError) return { error: accessError };

  const rows = eachDateInRange(startIso, endIso).map((date) => ({ car_id: carId, date }));
  const { error } = await supabase
    .from("car_availability")
    .upsert(rows, { onConflict: "car_id,date", ignoreDuplicates: true });
  if (error) return { error: carWriteErrorMessage(error, SAVE_FAILED, "addAvailabilityRange failed") };

  revalidatePath(`/dashboard/cars/${carId}/availability`);
  revalidatePath(`/auta/${carId}`);
  return { error: null };
}

export async function removeAvailabilityRange(
  carId: string,
  startIso: string,
  endIso: string
): Promise<AvailabilityResult> {
  const { supabase, error: accessError } = await ownCarForAvailability(carId, startIso, endIso);
  if (accessError) return { error: accessError };

  const { error } = await supabase
    .from("car_availability")
    .delete()
    .eq("car_id", carId)
    .gte("date", startIso)
    .lte("date", endIso);
  if (error) return { error: carWriteErrorMessage(error, SAVE_FAILED, "removeAvailabilityRange failed") };

  revalidatePath(`/dashboard/cars/${carId}/availability`);
  revalidatePath(`/auta/${carId}`);
  return { error: null };
}
