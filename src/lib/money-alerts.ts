import "server-only";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";

// Same inbox the new-registration alert uses (src/app/(auth)/actions.ts).
const ADMIN_ALERT_EMAIL = "user@gomambo.pl";

export type MoneyFailureType = "refund_failed" | "deposit_release_failed";

/**
 * Money that should have moved and didn't. Two channels on purpose: the
 * in-app notification is what an admin sees day to day, but it is one
 * INSERT behind a type CHECK constraint — if that ever rejects, the only
 * trace left would be a console line nobody reads. Never throws: every
 * caller reaches this after a Stripe call has already succeeded or failed,
 * and must not have its own flow aborted by an alerting problem.
 */
export async function reportMoneyFailure(type: MoneyFailureType, body: string): Promise<void> {
  console.error(`[${type}]`, body);

  const admin = tryCreateAdminClient();
  if (admin) {
    try {
      const { error: insertError } = await admin
        .from("admin_notifications")
        .insert({ type, body, link: "/admin/bookings" });
      if (insertError) {
        console.error(`[${type}] admin notification insert failed`, {
          code: insertError.code,
          message: insertError.message,
        });
      }
    } catch (notifyError) {
      console.error(`[${type}] admin notification threw`, notifyError);
    }
  }

  await sendNotificationEmail({
    to: ADMIN_ALERT_EMAIL,
    subject:
      type === "refund_failed"
        ? "GoMambo: zwrot płatności nie powiódł się"
        : "GoMambo: zwolnienie kaucji nie powiodło się",
    html: `<p>${body}</p><p><a href="${SITE_URL}/admin/bookings">Panel rezerwacji →</a></p>`,
  });
}
