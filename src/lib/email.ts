import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL ?? "GoMambo <powiadomienia@gomambo.pl>";

export async function sendNotificationEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error("[email] Resend returned an error:", error);
    }
  } catch (err) {
    console.error("[email] failed to send:", err);
  }
}

// Unlike sendNotificationEmail (fire-and-forget FYI mail, silent no-op on
// failure), a one-time code is useless if the send silently failed — the
// caller needs to know so it can tell the user to retry instead of leaving
// them stuck waiting for a code that never arrives.
export async function sendCodeEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error("[email] Resend returned an error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] failed to send:", err);
    return false;
  }
}
