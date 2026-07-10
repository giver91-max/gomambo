"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markAdminMessagesRead(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const rows = messageIds.map((messageId) => ({ message_id: messageId, user_id: user.id }));
  await supabase.from("admin_message_reads").upsert(rows, { onConflict: "message_id,user_id" });

  revalidatePath("/dashboard/notifications");
}
