import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Shared by dashboard/layout.tsx and admin/layout.tsx to badge the nav —
// two independent unread counts: chat (booking threads + the admin support
// chat), and system notifications (admin-only: new registrations/cars).
// Every round trip to Supabase costs full network latency, so independent
// queries are batched with Promise.all instead of awaited one at a time.
export async function getUnreadCounts(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{ unreadMessages: number; unreadNotifications: number }> {
  const [
    { data: myConversations },
    { data: adminConversations },
    { data: systemNotifications },
    { count: unreadPersonalCount },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id")
      .or(`owner_id.eq.${userId},renter_id.eq.${userId}`),
    // RLS returns only the caller's own thread for a regular user, or
    // every thread for an admin — same "my rows" shape as above.
    supabase.from("admin_conversations").select("id"),
    // Only returns rows for admins — RLS restricts admin_notifications to is_admin().
    supabase.from("admin_notifications").select("id").is("deleted_at", null),
    // Per-user notifications (e.g. car approved/rejected) — everyone gets these.
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null)
      .is("deleted_at", null),
  ]);

  const conversationIds = (myConversations ?? []).map((c) => c.id);
  const adminConversationIds = (adminConversations ?? []).map((c) => c.id);
  const systemNotificationIds = (systemNotifications ?? []).map((n) => n.id);

  const [messagesCount, adminChatCount, systemReads] = await Promise.all([
    conversationIds.length > 0
      ? supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .in("conversation_id", conversationIds)
          .neq("sender_id", userId)
          .is("read_at", null)
          .is("deleted_at", null)
      : Promise.resolve({ count: 0 }),
    adminConversationIds.length > 0
      ? supabase
          .from("admin_chat_messages")
          .select("id", { count: "exact", head: true })
          .in("conversation_id", adminConversationIds)
          .neq("sender_id", userId)
          .is("read_at", null)
          .is("deleted_at", null)
      : Promise.resolve({ count: 0 }),
    systemNotificationIds.length > 0
      ? supabase
          .from("admin_notification_reads")
          .select("notification_id")
          .eq("user_id", userId)
          .in("notification_id", systemNotificationIds)
      : Promise.resolve({ data: [] as { notification_id: string }[] }),
  ]);

  const unreadMessages = (messagesCount.count ?? 0) + (adminChatCount.count ?? 0);

  const readSystemIds = new Set((systemReads.data ?? []).map((r) => r.notification_id));
  const unreadSystemCount = systemNotificationIds.filter((id) => !readSystemIds.has(id)).length;
  const unreadNotifications = unreadSystemCount + (unreadPersonalCount ?? 0);

  return { unreadMessages, unreadNotifications };
}

const ADMIN_USER_LINK = /^\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Admin notifications about a new account link to /admin/users/<id>. When the
 * account is deleted later, its notifications stay and the link opens a 404.
 * Returns the links whose account no longer exists, so the lists can say
 * "konto usunięte" instead of offering a dead link. One query for all of them.
 */
export async function findDeletedAccountLinks(
  supabase: SupabaseClient<Database>,
  links: (string | null)[]
): Promise<Set<string>> {
  const idByLink = new Map<string, string>();
  for (const link of links) {
    const match = link ? ADMIN_USER_LINK.exec(link) : null;
    if (link && match) idByLink.set(link, match[1].toLowerCase());
  }
  if (idByLink.size === 0) return new Set();

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .in("id", Array.from(new Set(idByLink.values())));
  // Unknown is not "deleted": on a failed lookup keep every link.
  if (error) return new Set();
  const existing = new Set((data ?? []).map((p) => p.id.toLowerCase()));
  return new Set(Array.from(idByLink).filter(([, id]) => !existing.has(id)).map(([link]) => link));
}
