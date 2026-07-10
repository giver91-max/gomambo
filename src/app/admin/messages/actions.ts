"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function sendAdminMessage(
  recipientId: string | null,
  body: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return { error: "Napisz treść wiadomości." };
  }

  const { error } = await supabase.from("admin_messages").insert({
    sender_id: user.id,
    recipient_id: recipientId,
    body: trimmedBody,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/messages");
  return { error: null };
}
