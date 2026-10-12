import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { notifyAdmins } from "@/lib/notify-admins";
import {
  assessmentReasons,
  describeAssessment,
  describeExpiry,
  type IdentityAssessment,
} from "@/lib/identity-gates";

/**
 * At most one alert per verification every ALERT_COOLDOWN_MINUTES. The desktop
 * route can be called in a loop, and every alert is an e-mail through the
 * same Resend account that delivers login codes — unthrottled, one account
 * could have exhausted the day's quota and locked everyone else out of code
 * sign-in. The admins lose nothing by it: a resubmission inside the window
 * replaces the photos of a case they were already told about, and the panel
 * always shows the latest. An admin rejection clears the timestamp, so a
 * resubmission AFTER a rejection is never swallowed.
 */
const ALERT_COOLDOWN_MINUTES = 15;

/**
 * Atomically takes the right to alert about this verification. Only one of
 * two racing submissions gets a row back, so a double click cannot send two
 * e-mails either. Fails CLOSED on a database error — a missed alert is
 * recoverable (the case is in the panel), an e-mail flood is not.
 */
async function claimAlert(
  admin: SupabaseClient<Database>,
  verificationId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("identity_verifications")
    .update({ admin_alerted_at: new Date().toISOString() })
    .eq("id", verificationId)
    // Quoted: an ISO timestamp contains ":" and ".", which PostgREST's or()
    // grammar would otherwise split on.
    .or(`admin_alerted_at.is.null,admin_alerted_at.lt."${cutoff}"`)
    .select("id");
  if (error) {
    console.error("[identity-alerts] could not claim the alert slot", {
      verificationId,
      message: error.message,
    });
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Tells the admins about one identity verification — by e-mail always, and
 * in the panel queue when someone has to act.
 *
 * Shared by the phone (QR) route and the desktop route, which previously each
 * carried their own copy of this block and sent no e-mail at all: a
 * verification waiting for a human was announced only in a panel nobody was
 * watching, and people sat for days.
 *
 * Automatically approved verifications get an e-mail too, deliberately. The
 * automatic approval cannot tell a live person from a photograph of one (no
 * liveness detection yet), so a human glancing at each one is the remaining
 * safety net — it just isn't a to-do, so it stays out of the queue.
 */
export async function alertAdminsAboutVerification(
  admin: SupabaseClient<Database>,
  {
    verificationId,
    fullName,
    email,
    route,
    assessment,
    autoApproved,
    previouslyRejected,
    previousRejectionReason,
  }: {
    verificationId: string;
    fullName: string;
    email: string | null | undefined;
    route: "telefon" | "komputer";
    assessment: IdentityAssessment;
    autoApproved: boolean;
    previouslyRejected: boolean;
    previousRejectionReason: string | null | undefined;
  }
): Promise<void> {
  if (!(await claimAlert(admin, verificationId))) return;

  const score =
    assessment.match.score !== null ? `${assessment.match.score.toFixed(1)}%` : "brak wyniku";

  if (autoApproved) {
    await notifyAdmins(admin, {
      link: "/admin/verifications",
      email: {
        subject: `✓ Weryfikacja zatwierdzona automatycznie: ${fullName}`,
        intro:
          "Automat zatwierdził weryfikację tożsamości — nic nie musisz robić. Warto rzucić okiem na zdjęcia: automat nie odróżni żywej osoby od zdjęcia zdjęcia.",
        rows: [
          ["Osoba", fullName],
          ["E-mail", email],
          ["Wysłane z", route],
          ["Zgodność twarzy", score],
          ["Prawo jazdy ważne do", describeExpiry(assessment)],
        ],
        cta: "Zobacz zdjęcia",
      },
    });
    return;
  }

  const reasons = assessmentReasons(assessment);

  // A resubmission after a rejection is the case that must never pass
  // quietly, so it leads both the queue entry and the e-mail.
  const rejectedNote = previouslyRejected
    ? `UWAGA: to konto było wcześniej ODRZUCONE${
        previousRejectionReason ? ` (powód: ${previousRejectionReason})` : ""
      }.`
    : null;

  await notifyAdmins(admin, {
    queue: {
      type: "new_identity_verification",
      body: `${rejectedNote ? `${rejectedNote} ` : ""}Nowe zgłoszenie weryfikacji tożsamości (${route}): ${fullName}.${describeAssessment(
        assessment
      )}`,
    },
    link: "/admin/verifications",
    email: {
      subject: `${previouslyRejected ? "⚠ Ponowne zgłoszenie po odrzuceniu" : "Weryfikacja do sprawdzenia"}: ${fullName}`,
      intro: rejectedNote
        ? `${rejectedNote} Ta osoba wysłała zdjęcia jeszcze raz — automat nigdy nie zatwierdza takiego zgłoszenia sam, decyzja jest Twoja.`
        : "Ktoś czeka na zatwierdzenie weryfikacji tożsamości. Dopóki jej nie zatwierdzisz, nie doda auta ani nie zarezerwuje.",
      rows: [
        ["Osoba", fullName],
        ["E-mail", email],
        ["Wysłane z", route],
        ["Zgodność twarzy", score],
        ["Prawo jazdy ważne do", describeExpiry(assessment)],
        ["Dlaczego nie automatycznie", reasons.length ? reasons.join("; ") : "wcześniejsze odrzucenie"],
      ],
      cta: "Sprawdź i zdecyduj",
    },
  });
}
