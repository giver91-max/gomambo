"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleFavorite(carId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Zaloguj się, aby dodawać ulubione." };
  }

  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("car_id", carId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("favorites")
      .insert({ user_id: user.id, car_id: carId });
    if (error) return { error: error.message };
  }

  revalidatePath("/auta");
  revalidatePath(`/auta/${carId}`);
  revalidatePath("/dashboard/favorites");
  return { error: null };
}
