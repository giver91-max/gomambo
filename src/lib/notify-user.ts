import "server-only";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { sendNotificationSms } from "@/lib/sms";
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
  fallbackType,
}: {
  userId: string;
  type: NotificationType;
  subject: string;
  emailHtml: string;
  body: string;
  link?: string;
  /**
   * An older type to store instead when the CHECK constraint does not know
   * `type` yet (code 23514) — the code can then deploy before the migration
   * that adds the type, without the in-app entry being lost.
   */
  fallbackType?: NotificationType;
}) {
  // Never throw: callers reach this AFTER money has already moved (refunds,
  // deposit releases), so a misconfigured service-role key must not turn a
  // completed cancellation into a failed server action.
  const admin = tryCreateAdminClient();
  if (!admin) {
    console.error("[notify-user] skipped, admin client unavailable", { userId, type });
    return;
  }

  // supabase-js resolves DB errors into { error } rather than throwing, so
  // without this a rejected insert (e.g. a type the CHECK doesn't know yet)
  // would vanish silently. The email below still goes out either way.
  let { error: insertError } = await admin
    .from("notifications")
    .insert({ user_id: userId, type, body, link });
  if (insertError?.code === "23514" && fallbackType) {
    console.warn("[notify-user] type not allowed yet, storing fallback", { userId, type, fallbackType });
    ({ error: insertError } = await admin
      .from("notifications")
      .insert({ user_id: userId, type: fallbackType, body, link }));
  }
  if (insertError) {
    console.error("[notify-user] notification insert failed", {
      userId,
      type,
      code: insertError.code,
      message: insertError.message,
    });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("notify_email, notify_sms, phone")
    .eq("id", userId)
    .single();

  if (profile?.notify_email !== false) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    if (email) {
      await sendNotificationEmail({ to: email, subject, html: emailHtml });
    }
  }

  if (profile?.notify_sms && profile.phone) {
    await sendNotificationSms(profile.phone, body);
  }
}
