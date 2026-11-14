import "server-only";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";

// Same inbox the new-registration alert uses (src/app/(auth)/actions.ts).
const ADMIN_ALERT_EMAIL = "user@gomambo.pl";

export type MoneyFailureType =
  | "refund_failed"
  | "deposit_refund_failed"
  | "deposit_transfer_failed"
  | "payment_disputed";

const SUBJECTS: Record<MoneyFailureType, string> = {
  refund_failed: "GoMambo: zwrot płatności nie powiódł się",
  deposit_refund_failed: "GoMambo: zwrot kaucji nie powiódł się",
  deposit_transfer_failed: "GoMambo: przelew zatrzymanej kaucji nie powiódł się",
  payment_disputed: "GoMambo: reklamacja płatności w banku (spór)",
};

// The deposit has its own desk; everything else is still handled from the
// bookings list.
const LINKS: Record<MoneyFailureType, string> = {
  refund_failed: "/admin/bookings",
  deposit_refund_failed: "/admin/kaucje",
  deposit_transfer_failed: "/admin/kaucje",
  payment_disputed: "/admin/kaucje",
};

/**
 * Money that should have moved and didn't. Two channels on purpose: the
 * in-app notification is what an admin sees day to day, but it is one
 * INSERT behind a type CHECK constraint — if that ever rejects, the only
 * trace left would be a console line nobody reads. Never throws: every
 * caller reaches this after a Stripe call has already succeeded or failed,
 * and must not have its own flow aborted by an alerting problem.
 *
 * The body is plain text and escaped here: some callers quote a car's brand
 * and model, which the owner typed.
 */
export async function reportMoneyFailure(type: MoneyFailureType, body: string): Promise<void> {
  console.error(`[${type}]`, body);
  const link = LINKS[type];

  const admin = tryCreateAdminClient();
  if (admin) {
    try {
      const { error: insertError } = await admin
        .from("admin_notifications")
        .insert({ type, body, link });
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
    subject: SUBJECTS[type],
    html: `<p>${escapeHtml(body)}</p><p><a href="${SITE_URL}${link}">Otwórz panel →</a></p>`,
  });
}
