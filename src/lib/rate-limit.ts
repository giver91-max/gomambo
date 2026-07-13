import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const WINDOW_MS = 60_000;
const MAX_MESSAGES_PER_WINDOW = 10;

// Chat messages have no recaptcha (unlike the public forms), so a logged-in
// user could otherwise send unlimited messages with no throttle at all.
export async function isSendingTooFast(
  supabase: SupabaseClient<Database>,
  table: "messages" | "admin_chat_messages",
  userId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("sender_id", userId)
    .gte("created_at", cutoff);
  return (count ?? 0) >= MAX_MESSAGES_PER_WINDOW;
}
