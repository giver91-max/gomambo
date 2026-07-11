import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Shared by dashboard/layout.tsx and admin/layout.tsx to badge the nav —
// two independent unread counts: chat (booking threads + the admin support
// chat), and system notifications (admin-only: new registrations/cars).
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

  // RLS returns only the caller's own thread for a regular user, or every
  // thread for an admin — same "my rows" shape as the conversations query above.
  const { data: adminConversations } = await supabase.from("admin_conversations").select("id");
  const adminConversationIds = (adminConversations ?? []).map((c) => c.id);
  if (adminConversationIds.length > 0) {
    const { count } = await supabase
      .from("admin_chat_messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", adminConversationIds)
      .neq("sender_id", userId)
      .is("read_at", null);
    unreadMessages += count ?? 0;
  }

  // Only returns rows for admins — RLS restricts admin_notifications to is_admin().
  const { data: systemNotifications } = await supabase.from("admin_notifications").select("id");
  const systemNotificationIds = (systemNotifications ?? []).map((n) => n.id);
  let unreadNotifications = 0;
  if (systemNotificationIds.length > 0) {
    const { data: reads } = await supabase
      .from("admin_notification_reads")
      .select("notification_id")
      .eq("user_id", userId)
      .in("notification_id", systemNotificationIds);
    const readIds = new Set((reads ?? []).map((r) => r.notification_id));
    unreadNotifications = systemNotificationIds.filter((id) => !readIds.has(id)).length;
  }

  return { unreadMessages, unreadNotifications };
}
