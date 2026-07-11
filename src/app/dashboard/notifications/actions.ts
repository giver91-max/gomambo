"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
