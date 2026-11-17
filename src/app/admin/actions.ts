"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Returns the problem instead of throwing it: in production Next replaces a
// thrown server-action message with a generic English one.
export async function setMaintenanceMode(enabled: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_settings")
    .update({ maintenance_mode: enabled })
    .eq("id", 1)
    .select("maintenance_mode")
    .maybeSingle();

  if (error) return { error: `Nie udało się zmienić ustawienia: ${error.message}` };
  // No row back means RLS matched nothing — typically an expired session.
  if (!data) return { error: "Nie udało się zmienić ustawienia — zaloguj się ponownie i spróbuj jeszcze raz." };
  revalidatePath("/admin");
  revalidatePath("/auta");
  revalidatePath("/");
  return { error: null };
}
