import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// admin_conversations has no UPDATE policy (nothing on it needs updating),
// so this can't use a plain upsert — find the row, or insert it and fall
// back to a re-select if a concurrent request won the insert race.
export async function getOrCreateAdminConversation(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("admin_conversations")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await supabase
    .from("admin_conversations")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (created) return created.id;

  const { data: retry } = await supabase
    .from("admin_conversations")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return retry?.id ?? null;
}
