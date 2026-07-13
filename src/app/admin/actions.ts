"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setMaintenanceMode(enabled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .update({ maintenance_mode: enabled })
    .eq("id", 1);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/auta");
  revalidatePath("/");
}
