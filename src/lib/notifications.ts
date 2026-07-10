import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Shared by dashboard/layout.tsx and admin/layout.tsx to badge the nav —
// two independent unread counts: the owner/renter booking chat, and
// admin-to-user announcements/direct messages.
export async function getUnreadCounts(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{ unreadMessages: number; unreadNotifications: number }> {
  const { data: myConversations } = await supabase
    .from("conversations")
    .select("id")
    .or(`owner_id.eq.${userId},renter_id.eq.${userId}`);
  const conversationIds = (myConversations ?? []).map((c) => c.id);

  let unreadMessages = 0;
  if (conversationIds.length > 0) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds)
      .neq("sender_id", userId)
      .is("read_at", null);
    unreadMessages = count ?? 0;
  }

  const { data: adminMessages } = await supabase
    .from("admin_messages")
    .select("id")
    .or(`recipient_id.eq.${userId},recipient_id.is.null`);
  const adminMessageIds = (adminMessages ?? []).map((m) => m.id);

  let unreadNotifications = 0;
  if (adminMessageIds.length > 0) {
    const { data: reads } = await supabase
      .from("admin_message_reads")
      .select("message_id")
      .eq("user_id", userId)
      .in("message_id", adminMessageIds);
    const readIds = new Set((reads ?? []).map((r) => r.message_id));
    unreadNotifications = adminMessageIds.filter((id) => !readIds.has(id)).length;
  }

  return { unreadMessages, unreadNotifications };
}
