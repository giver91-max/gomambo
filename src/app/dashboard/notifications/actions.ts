"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The unread badge lives in the LAYOUT (see dashboard/layout.tsx and
// admin/layout.tsx, both calling getUnreadCounts). Revalidating only
// "/dashboard/notifications" left it untouched, so the count next to your
// name kept showing notifications you had just read — you clicked, and
// nothing disappeared. Both layouts have to be revalidated, on both trees,
// because an admin sees the same badge under /admin.
function revalidateNotificationSurfaces(): void {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/admin", "layout");
}

export async function markAdminNotificationsRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const rows = notificationIds.map((notificationId) => ({ notification_id: notificationId, user_id: user.id }));
  // DO NOTHING, not DO UPDATE. A read marker has nothing to update — it
  // either exists or it doesn't — and admin_notification_reads has no UPDATE
  // policy (0012 grants SELECT and INSERT only), so the ON CONFLICT DO UPDATE
  // that upsert defaults to was rejected by RLS whenever two tabs raced. The
  // error was then swallowed by the missing error check below.
  const { error } = await supabase
    .from("admin_notification_reads")
    .upsert(rows, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
  if (error) console.error("markAdminNotificationsRead failed", error);

  revalidateNotificationSurfaces();
}

/** One notification, marked read from the admin dashboard's activity list. */
export async function markAdminNotificationRead(
  notificationId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Zaloguj się ponownie." };

  const { error } = await supabase
    .from("admin_notification_reads")
    .upsert(
      { notification_id: notificationId, user_id: user.id },
      { onConflict: "notification_id,user_id", ignoreDuplicates: true }
    );
  if (error) return { error: error.message };

  revalidateNotificationSurfaces();
  return { error: null };
}

export async function markNotificationsRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in("id", notificationIds)
    .is("read_at", null);

  revalidateNotificationSurfaces();
}

// Own notification, own choice — notifications_update_own RLS already
// permits this through the regular session client, no service-role needed.
export async function deleteNotification(notificationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Zaloguj się ponownie." };

  const { error } = await supabase
    .from("notifications")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", user.id);
  if (error) {
    return { error: error.message };
  }

  revalidateNotificationSurfaces();
  return { error: null };
}

// admin_notifications has no update/delete RLS at all (select/insert are
// is_admin()-only) — only reachable by admins in the UI anyway (see
// notifications/page.tsx), but service-role is still required to write it.
export async function deleteAdminNotification(notificationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Zaloguj się ponownie." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: "Brak uprawnień." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("admin_notifications")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) {
    return { error: error.message };
  }

  revalidateNotificationSurfaces();
  return { error: null };
}
