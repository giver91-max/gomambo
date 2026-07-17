"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markAdminNotificationsRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const rows = notificationIds.map((notificationId) => ({ notification_id: notificationId, user_id: user.id }));
  await supabase
    .from("admin_notification_reads")
    .upsert(rows, { onConflict: "notification_id,user_id" });

  revalidatePath("/dashboard/notifications");
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

  revalidatePath("/dashboard/notifications");
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

  revalidatePath("/dashboard/notifications");
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

  revalidatePath("/dashboard/notifications");
  return { error: null };
}
