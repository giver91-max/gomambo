import type { SupabaseClient } from "@supabase/supabase-js";
import { CANCELLATION_POLICY_FREE_HOURS } from "@/lib/car-options";
import {
  expireCheckoutSession,
  getCheckoutSessionPayment,
  refundCheckoutSession,
  releaseDeposit,
} from "@/lib/stripe";
import { reportMoneyFailure } from "@/lib/money-alerts";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { CancellationPolicy, Database, DepositStatus, PaymentStatus } from "@/types/database";

export function freeCancellationDeadline(policy: CancellationPolicy, startDate: string): Date {
  const freeHours = CANCELLATION_POLICY_FREE_HOURS[policy];
  return new Date(new Date(`${startDate}T00:00:00`).getTime() - freeHours * 60 * 60 * 1000);
}

export function isWithinFreeCancellationWindow(
  policy: CancellationPolicy,
  startDate: string
): boolean {
  return new Date() < freeCancellationDeadline(policy, startDate);
}

// "refunded": the rental fee AND every paid extension came back.
// "partially_refunded": the base fee came back but an extension's refund was
// rejected — the renter is still owed money. "refund_unverified": the base
// fee came back but the extensions couldn't even be read, so whether
// anything is still owed is unknown (usually there are none — don't alarm
// the renter over it). "failed": the base refund itself was rejected.
// "not_due": paid, but outside the free-cancellation window.
// "not_applicable": nothing had been paid.
export type CancellationRefundOutcome =
  | "refunded"
  | "partially_refunded"
  | "refund_unverified"
  | "failed"
  | "not_due"
  | "not_applicable";

export type DepositReleaseOutcome = "released" | "failed" | "not_applicable";

export type CancellationResult = {
  refund: CancellationRefundOutcome;
  deposit: DepositReleaseOutcome;
  error?: string;
};

// The one sentence the renter is told about their money. Kept here so the
// renter-cancel and owner-cancel paths can never drift into promising a
// "pełny zwrot" that didn't happen.
export function renterRefundSentence(outcome: CancellationRefundOutcome): string {
  switch (outcome) {
    case "refunded":
      return " Otrzymasz pełny zwrot.";
    case "partially_refunded":
    case "failed":
      return " Automatyczny zwrot płatności nie powiódł się w całości — wykonamy go ręcznie i potwierdzimy, nie musisz nic robić.";
    case "refund_unverified":
      // Almost always a full refund we simply couldn't confirm; don't claim
      // a failure that probably didn't happen, don't promise completeness.
      return " Zwrot płatności został zlecony — potwierdzimy go osobno, nie musisz nic robić.";
    default:
      return "";
  }
}

// Shared by the renter's own cancelBooking, the admin override
// (adminCancelBooking), and the owner's ownerCancelBooking — same
// money-handling rules either way: neutralise any half-finished extension
// checkout, release any held deposit (nothing left to hold once the trip is
// off), refund the rental fee only if still inside the free-cancellation
// window — UNLESS forceFullRefund is set. That window exists to protect the
// OWNER from a late renter-initiated cancellation; it has no meaning when
// the OWNER is the one cancelling an already-confirmed booking, so that
// path always passes forceFullRefund: true instead.
export async function cancelBookingWithRefund(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  booking: {
    start_date: string;
    payment_status: PaymentStatus;
    stripe_checkout_session_id: string | null;
    deposit_status: DepositStatus;
    stripe_deposit_payment_intent_id: string | null;
    cancellation_policy: CancellationPolicy;
  },
  options: { forceFullRefund?: boolean } = {}
): Promise<CancellationResult> {
  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  // Before anything else, and regardless of whether the base fee is
  // refundable: an extension checkout left open in another tab stays payable
  // for ~24h, and the webhook would happily extend a cancelled booking.
  await neutralisePendingExtensions(bookingId);

  let deposit: DepositReleaseOutcome = "not_applicable";
  if (booking.deposit_status === "held" && booking.stripe_deposit_payment_intent_id) {
    const releaseResult = await releaseDeposit(booking.stripe_deposit_payment_intent_id);
    if (releaseResult.ok) {
      await supabase.from("bookings").update({ deposit_status: "released" }).eq("id", bookingId);
      deposit = "released";
    } else {
      // Nothing can retry this: the booking is already 'cancelled', and the
      // only other release path requires status 'completed'. Left alone, the
      // renter's money stays blocked on their card until Stripe's ~7-day
      // authorisation expiry, with no trace anywhere.
      deposit = "failed";
      await reportMoneyFailure(
        "deposit_release_failed",
        `Nie udało się zwolnić kaucji przy anulowaniu rezerwacji ${bookingId} (${releaseResult.error}). Środki nadal są zablokowane na karcie najemcy — anuluj płatność ${booking.stripe_deposit_payment_intent_id} ręcznie w Stripe.`
      );
    }
  }

  if (booking.payment_status !== "paid" || !booking.stripe_checkout_session_id) {
    return { refund: "not_applicable", deposit };
  }
  if (
    !options.forceFullRefund &&
    !isWithinFreeCancellationWindow(booking.cancellation_policy, booking.start_date)
  ) {
    return { refund: "not_due", deposit };
  }

  const refundResult = await refundCheckoutSession(booking.stripe_checkout_session_id);
  if (!refundResult.ok) {
    await reportMoneyFailure(
      "refund_failed",
      `Zwrot za anulowaną rezerwację ${bookingId} nie powiódł się (${refundResult.error}). Płatność nadal ma status „opłacona” — zwrot trzeba wykonać ręcznie w Stripe.`
    );
    return { refund: "failed", deposit, error: refundResult.error };
  }

  const extensions = await refundPaidExtensions(bookingId);
  if (extensions.status !== "ok") {
    // The base fee has left the platform account, so the row must stop
    // claiming 'paid' — but it isn't a clean 'refunded' either, because an
    // extension is either unrefunded or unchecked.
    await supabase
      .from("bookings")
      .update({ payment_status: "partially_refunded" })
      .eq("id", bookingId);
    return {
      refund: extensions.status === "partial" ? "partially_refunded" : "refund_unverified",
      deposit,
      error: extensions.error,
    };
  }

  await supabase.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
  return { refund: "refunded", deposit };
}

// An extension whose Checkout Session was created but never completed. If it
// was in fact paid (webhook not landed yet, or never will now), the money
// goes back; otherwise the session is expired so a stale tab can't complete
// it later. Marked 'expired' either way, which is also what stops the
// webhook from applying it — it only acts on 'pending' rows.
async function neutralisePendingExtensions(bookingId: string): Promise<void> {
  const admin = tryCreateAdminClient();
  if (!admin) return;

  const { data: pending, error } = await admin
    .from("booking_extensions")
    .select("id, stripe_checkout_session_id")
    .eq("booking_id", bookingId)
    .eq("status", "pending")
    .not("stripe_checkout_session_id", "is", null);
  if (error || !pending || pending.length === 0) return;

  for (const extension of pending) {
    const sessionId = extension.stripe_checkout_session_id;
    if (!sessionId) continue;

    const state = await getCheckoutSessionPayment(sessionId);
    // "complete" is not the same as paid — a BLIK session is complete while
    // still settling, and refunding it would only produce a false alarm.
    const alreadyPaid =
      state.ok &&
      (state.data.paymentStatus === "paid" || state.data.paymentIntentStatus === "succeeded");

    if (alreadyPaid) {
      const refund = await refundCheckoutSession(sessionId);
      await admin
        .from("booking_extensions")
        .update({
          status: "expired",
          ...(refund.ok ? { refunded_at: new Date().toISOString() } : {}),
        })
        .eq("id", extension.id);
      if (!refund.ok) {
        await reportMoneyFailure(
          "refund_failed",
          `Przedłużenie ${extension.id} rezerwacji ${bookingId} zostało opłacone tuż przed anulowaniem, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć płatność ${sessionId} ręcznie w Stripe.`
        );
      }
      continue;
    }

    const expired = await expireCheckoutSession(sessionId);
    if (expired.ok) {
      await admin.from("booking_extensions").update({ status: "expired" }).eq("id", extension.id);
      continue;
    }

    // Stripe only refuses to expire a session that stopped being open — so
    // it was most likely just paid.
    const recheck = await getCheckoutSessionPayment(sessionId);
    if (
      recheck.ok &&
      (recheck.data.paymentStatus === "paid" || recheck.data.paymentIntentStatus === "succeeded")
    ) {
      const refund = await refundCheckoutSession(sessionId);
      await admin
        .from("booking_extensions")
        .update({
          status: "expired",
          ...(refund.ok ? { refunded_at: new Date().toISOString() } : {}),
        })
        .eq("id", extension.id);
      if (!refund.ok) {
        await reportMoneyFailure(
          "refund_failed",
          `Przedłużenie ${extension.id} rezerwacji ${bookingId} zostało opłacone tuż przed anulowaniem, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć płatność ${sessionId} ręcznie w Stripe.`
        );
      }
      continue;
    }

    // We don't know whether the session is still alive. Leave it 'pending'
    // ON PURPOSE: the booking is already 'cancelled', so if a payment does
    // arrive the webhook refunds it. Marking it 'expired' here would be a
    // lie that silences that safety net.
    await reportMoneyFailure(
      "refund_failed",
      `Nie udało się wygasić sesji ${sessionId} przedłużenia ${extension.id} (rezerwacja ${bookingId}): ${expired.error}. Sesja może być nadal opłacalna — sprawdź ją w Stripe.`
    );
  }
}

type ExtensionRefundResult =
  | { status: "ok"; error?: undefined }
  | { status: "unverified"; error: string }
  | { status: "partial"; error: string };

// A paid trip extension is a SECOND Stripe charge with its own Checkout
// Session on booking_extensions; bookings.total_price already includes it,
// so refunding only the base session returns less than the renter paid.
// Service-role client on purpose: booking_extensions has no UPDATE policy,
// so a session-scoped write would match zero rows and report no error.
async function refundPaidExtensions(bookingId: string): Promise<ExtensionRefundResult> {
  // Non-throwing: the base refund has already gone through by this point, so
  // a missing service-role key must degrade to "unverified", not blow up the
  // whole cancellation.
  const admin = tryCreateAdminClient();
  if (!admin) {
    await reportMoneyFailure(
      "refund_failed",
      `Nie udało się sprawdzić opłaconych przedłużeń rezerwacji ${bookingId} (brak klienta service-role). Opłata podstawowa została zwrócona — sprawdź w Stripe, czy nie trzeba zwrócić także przedłużenia.`
    );
    return { status: "unverified", error: "Nie udało się sprawdzić przedłużeń wynajmu." };
  }

  const selectExtensions = () =>
    admin
      .from("booking_extensions")
      .select("id, stripe_checkout_session_id")
      .eq("booking_id", bookingId)
      .eq("status", "paid")
      .is("refunded_at", null);

  // One retry: a transient PostgREST/network blip here would otherwise mark
  // a perfectly complete refund as suspect and alarm the renter.
  let { data: extensions, error } = await selectExtensions();
  if (error) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    ({ data: extensions, error } = await selectExtensions());
  }

  if (error) {
    await reportMoneyFailure(
      "refund_failed",
      `Opłata podstawowa za rezerwację ${bookingId} została zwrócona, ale nie udało się odczytać przedłużeń (${error.message}). Sprawdź w Stripe, czy nie trzeba zwrócić także przedłużenia.`
    );
    return {
      status: "unverified",
      error: `Nie udało się sprawdzić przedłużeń wynajmu (${error.message}).`,
    };
  }

  const failed: string[] = [];
  for (const extension of extensions ?? []) {
    if (!extension.stripe_checkout_session_id) continue;
    const result = await refundCheckoutSession(extension.stripe_checkout_session_id);
    if (result.ok) {
      await admin
        .from("booking_extensions")
        .update({ refunded_at: new Date().toISOString() })
        .eq("id", extension.id);
    } else {
      failed.push(extension.id);
      await reportMoneyFailure(
        "refund_failed",
        `Zwrot za przedłużenie ${extension.id} (rezerwacja ${bookingId}) nie powiódł się (${result.error}). Opłata podstawowa została zwrócona — kwotę przedłużenia trzeba zwrócić ręcznie w Stripe.`
      );
    }
  }

  if (failed.length > 0) {
    return {
      status: "partial",
      error: `Nie udało się zwrócić opłaty za przedłużenie wynajmu (${failed.length}).`,
    };
  }
  return { status: "ok" };
}
