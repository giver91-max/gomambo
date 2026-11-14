import "server-only";
import { expireCheckoutSession, getCheckoutSessionPayment } from "@/lib/stripe";

// Lives here rather than in a "use server" file: every exported async
// function of such a file becomes a server action anyone can call, and this
// one expires whichever Checkout Session id it is handed.

export type PreviousSessionState =
  | { kind: "clear" }
  | {
      kind: "paid";
      sessionId: string;
      paymentIntentId: string | null;
      amountTotalPln: number | null;
      applicationFeePln: number | null;
    }
  | { kind: "blocked"; error: string };

export function sessionWasPaid(data: {
  paymentStatus: string | null;
  paymentIntentStatus: string | null;
}): boolean {
  return data.paymentStatus === "paid" || data.paymentIntentStatus === "succeeded";
}

/**
 * A Checkout Session stays payable for ~24h, so before replacing one we have
 * to know what became of it. Fails CLOSED on purpose: when Stripe can't tell
 * us, we refuse to create a second session rather than leave two of them
 * payable — that is precisely how a renter ends up charged twice.
 */
export async function settlePreviousSession(sessionId: string | null): Promise<PreviousSessionState> {
  if (!sessionId) return { kind: "clear" };

  const previous = await getCheckoutSessionPayment(sessionId);
  if (!previous.ok) {
    // Stripe no longer knows this session (e.g. a test/live key swap): it can
    // never be paid, so there is nothing left to guard against.
    if (previous.code === "resource_missing") return { kind: "clear" };
    return {
      kind: "blocked",
      error: "Nie udało się zweryfikować poprzedniej płatności. Spróbuj ponownie za chwilę.",
    };
  }

  if (sessionWasPaid(previous.data)) {
    return {
      kind: "paid",
      sessionId,
      paymentIntentId: previous.data.paymentIntentId,
      amountTotalPln: previous.data.amountTotalPln,
      applicationFeePln: previous.data.applicationFeePln,
    };
  }

  if (previous.data.status === "open") {
    const expired = await expireCheckoutSession(sessionId);
    if (expired.ok) return { kind: "clear" };
    // Stripe only refuses to expire a session that stopped being open — most
    // likely it was paid in the moment between these two calls.
    const recheck = await getCheckoutSessionPayment(sessionId);
    if (recheck.ok && sessionWasPaid(recheck.data)) {
      return {
        kind: "paid",
        sessionId,
        paymentIntentId: recheck.data.paymentIntentId,
        amountTotalPln: recheck.data.amountTotalPln,
        applicationFeePln: recheck.data.applicationFeePln,
      };
    }
    return {
      kind: "blocked",
      error: "Nie udało się zamknąć poprzedniej płatności. Spróbuj ponownie za chwilę.",
    };
  }

  if (previous.data.status === "complete") {
    // Complete but unpaid = an async method (BLIK) either still settling or
    // already failed. Only the first is worth making the renter wait for;
    // after a failure the session is dead and a new one is the way forward.
    if (
      previous.data.paymentIntentStatus === "processing" ||
      previous.data.paymentIntentStatus === "requires_action"
    ) {
      return { kind: "blocked", error: "Płatność jest przetwarzana. Odśwież stronę za chwilę." };
    }
  }

  return { kind: "clear" };
}
