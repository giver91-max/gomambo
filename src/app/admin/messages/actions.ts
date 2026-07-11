"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";

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
  await notifyRecipientsByEmail(recipientId, trimmedBody);
  return { error: null };
}

async function notifyRecipientsByEmail(recipientId: string | null, body: string) {
  const supabase = await createClient();
  const admin = createAdminClient();

  let eligibleIds: string[];
  if (recipientId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", recipientId)
      .neq("notify_email", false)
      .maybeSingle();
    eligibleIds = profile ? [profile.id] : [];
  } else {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .neq("notify_email", false);
    eligibleIds = (profiles ?? []).map((p) => p.id);
  }

  if (eligibleIds.length === 0) return;

  const emails: string[] = [];
  for (const id of eligibleIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.push(data.user.email);
  }

  const subject = "Nowa wiadomość od GoMambo";
  const html = `
    <p>Masz nową wiadomość od zespołu GoMambo:</p>
    <p>${body.replace(/\n/g, "<br>")}</p>
    <p>Zobacz ją w swoim koncie na GoMambo (Powiadomienia).</p>
  `;

  await Promise.all(emails.map((to) => sendNotificationEmail({ to, subject, html })));
}
