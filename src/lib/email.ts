import "server-only";
import { Resend, type ErrorResponse } from "resend";

// Created on first use, not at import: the constructor throws when
// RESEND_API_KEY is missing, and at module level that throw would take down
// every server action that merely imports this file — a registration or a
// chat message failing because a notification could not be configured.
let client: Resend | null = null;
function resend(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

const FROM = process.env.RESEND_FROM_EMAIL ?? "GoMambo <powiadomienia@gomambo.pl>";

// Where a reply to any GoMambo mail lands. Without it replies go to the From
// address, a mailbox nobody reads — and people do answer notifications, e.g.
// with the list of cars they want added for them. kontakt@ is the address
// the footer, the Regulamin and the mails' "Pytania:" lines already give.
const REPLY_TO = process.env.RESEND_REPLY_TO_EMAIL ?? "kontakt@gomambo.pl";

// Resend answers 429 with Retry-After (seconds). Capped: this runs inside a
// server action, and a notification must never hold the user's click for long.
const MAX_RETRY_DELAY_MS = 2000;

function retryDelayMs(headers: Record<string, string> | null): number {
  const seconds = Number(headers?.["retry-after"]);
  const base = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
  // Jitter, so the mails fanned out to several admins at once do not all
  // come back in the same instant and trip the limit again.
  return Math.min(base + Math.floor(Math.random() * 400), MAX_RETRY_DELAY_MS);
}

/**
 * What to do after Resend refused a request. A 429 (rate_limit_exceeded — a
 * cron run or an alert to several admins can burst past the per-second
 * limit) is worth ONE retry after a short pause: it means nothing was
 * accepted, so the retry cannot deliver anything twice. Returns true when the
 * caller should try again.
 *
 * Quota errors are not retried: the daily or monthly allowance is gone and a
 * second try cannot succeed. They get a log line of their own, because from
 * that moment every mail on the site fails — login and phone-handoff codes
 * included — until the quota resets or the plan is raised.
 */
async function shouldRetry(
  error: ErrorResponse,
  headers: Record<string, string> | null,
  { subject, attempt }: { subject: string; attempt: number }
): Promise<boolean> {
  if (error.name === "rate_limit_exceeded" && attempt === 1) {
    console.warn("[email] Resend rate limit hit, retrying once", { subject });
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(headers)));
    return true;
  }

  if (error.name === "daily_quota_exceeded" || error.name === "monthly_quota_exceeded") {
    console.error(
      `[email] RESEND QUOTA EXHAUSTED (${error.name}) — mail NOT sent. Every mail fails until the quota resets or the Resend plan is raised.`,
      { subject }
    );
  } else {
    console.error("[email] Resend returned an error:", { subject, attempt, error });
  }
  return false;
}

/** One send, retried once when Resend says we are sending too fast (see shouldRetry). Never throws. */
async function send({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { error, headers } = await resend().emails.send({
        from: FROM,
        to,
        subject,
        html,
        replyTo: REPLY_TO,
      });
      if (!error) return true;
      if (!(await shouldRetry(error, headers, { subject, attempt }))) return false;
    }
    return false;
  } catch (err) {
    console.error("[email] failed to send:", { subject, err });
    return false;
  }
}

// The most mails Resend's batch endpoint takes in one request.
const BATCH_SIZE = 100;

/** One batch request of up to BATCH_SIZE mails; returns how many were not accepted. Never throws. */
async function sendBatch({ to, subject, html }: { to: string[]; subject: string; html: string }): Promise<number> {
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { data, error, headers } = await resend().batch.send(
        // A mail of its own to every address: nobody sees the others.
        to.map((address) => ({ from: FROM, to: address, subject, html, replyTo: REPLY_TO })),
        // One malformed address must not sink the rest of the batch.
        { batchValidation: "permissive" }
      );
      if (!error) {
        const refused = data.errors ?? [];
        if (refused.length > 0) {
          console.error("[email] Resend refused part of a batch:", { subject, refused });
        }
        return refused.length;
      }
      if (!(await shouldRetry(error, headers, { subject, attempt }))) return to.length;
    }
    return to.length;
  } catch (err) {
    console.error("[email] failed to send a batch:", { subject, err });
    return to.length;
  }
}

/**
 * The same FYI mail to many people at once — the admin broadcast. Goes out
 * through Resend's batch endpoint, one request per hundred addresses: sent
 * one by one, spaced for the per-second limit, a broadcast to every account
 * outran the server action's time limit part-way through, with the chat
 * messages already in and no record of who had been mailed. Returns how many
 * mails were not accepted. Never throws.
 */
export async function sendNotificationEmails({
  to,
  subject,
  html,
}: {
  to: string[];
  subject: string;
  html: string;
}): Promise<{ failed: number }> {
  let failed = 0;
  for (let start = 0; start < to.length; start += BATCH_SIZE) {
    failed += await sendBatch({ to: to.slice(start, start + BATCH_SIZE), subject, html });
  }
  return { failed };
}

/**
 * FYI mail. Never throws and never fails the caller: the action that
 * triggered it (a booking, a decision, a message) has already happened, and
 * a mail problem must not turn it into an error for the user. Most callers
 * fire and forget; the result is there for the few that report delivery
 * (the admin broadcast says how many mails did not go out).
 */
export async function sendNotificationEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  return send({ to, subject, html });
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
  return send({ to, subject, html });
}
