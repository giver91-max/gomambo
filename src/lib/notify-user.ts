import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import type { NotificationType } from "@/types/database";

// Shared by every place that needs to tell a user something happened to
// their account, car, or booking while they weren't looking — writes the
// in-app notification row and, unless they've turned email off, sends the
// matching email. Extracted from admin/cars/actions.ts so booking and
// identity-verification outcomes can use the exact same pattern instead of
// silently updating the database with no one ever finding out.
export async function notifyUser({
  userId,
  type,
  subject,
  emailHtml,
  body,
  link = "/dashboard",
}: {
  userId: string;
  type: NotificationType;
  subject: string;
  emailHtml: string;
  body: string;
  link?: string;
}) {
  const admin = createAdminClient();

  await admin.from("notifications").insert({ user_id: userId, type, body, link });

  const { data: profile } = await admin.from("profiles").select("notify_email").eq("id", userId).single();

  if (profile?.notify_email !== false) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (email) {
      await sendNotificationEmail({ to: email, subject, html: emailHtml });
    }
  }
}
