"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function approveCar(carId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cars")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", carId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function rejectCar(carId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cars")
    .update({ status: "rejected", rejection_reason: reason || "Brak podanego powodu." })
    .eq("id", carId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
