import "server-only";
import Stripe from "stripe";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Lazy singleton, null when unconfigured — same pattern as
// src/lib/face-match.ts. Every exported function below checks this first
// and returns a typed failure instead of throwing, so pages/actions that
// call into Stripe before the keys are configured degrade to "payments
// unavailable" instead of crashing.
const stripe = SECRET_KEY ? new Stripe(SECRET_KEY) : null;

export function isStripeConfigured(): boolean {
  return stripe !== null;
}

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string };

function failure<T>(context: string, error: unknown): StripeResult<T> {
  console.error(`${context}:`, error);
  const message = error instanceof Stripe.errors.StripeError ? error.message : "Nieznany błąd Stripe.";
  return { ok: false, error: message };
}

// --- Connect onboarding (owner payouts) ---------------------------------

export async function ensureConnectAccount(
  existingAccountId: string | null,
  email: string
): Promise<StripeResult<{ accountId: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    if (existingAccountId) return { ok: true, data: { accountId: existingAccountId } };
    const account = await stripe.accounts.create({
      type: "express",
      country: "PL",
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    return { ok: true, data: { accountId: account.id } };
  } catch (error) {
    return failure("ensureConnectAccount", error);
  }
}

export async function createAccountOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<StripeResult<{ url: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return { ok: true, data: { url: link.url } };
  } catch (error) {
    return failure("createAccountOnboardingLink", error);
  }
}

export async function isConnectAccountOnboarded(accountId: string): Promise<boolean> {
  if (!stripe) return false;
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return Boolean(account.charges_enabled && account.payouts_enabled);
  } catch (error) {
    console.error("isConnectAccountOnboarded:", error);
    return false;
  }
}

// --- Rental fee (captured immediately, split via Connect) ---------------

const PLATFORM_FEE_RATE = 0.15;

export function calculatePlatformFee(totalPrice: number): number {
  return Math.round(totalPrice * PLATFORM_FEE_RATE * 100) / 100;
}

export async function createRentalCheckoutSession(params: {
  bookingId: string;
  ownerStripeAccountId: string;
  totalPricePln: number;
  platformFeePln: number;
  description: string;
  renterEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeResult<{ sessionId: string; url: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: params.renterEmail,
      line_items: [
        {
          price_data: {
            currency: "pln",
            unit_amount: Math.round(params.totalPricePln * 100),
            product_data: { name: params.description },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: Math.round(params.platformFeePln * 100),
        transfer_data: { destination: params.ownerStripeAccountId },
      },
      metadata: { bookingId: params.bookingId },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) return { ok: false, error: "Stripe nie zwrócił adresu płatności." };
    return { ok: true, data: { sessionId: session.id, url: session.url } };
  } catch (error) {
    return failure("createRentalCheckoutSession", error);
  }
}

export async function refundCheckoutSession(
  sessionId: string
): Promise<StripeResult<{ refundId: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.payment_intent) return { ok: false, error: "Brak płatności do zwrotu." };
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      // Refund the platform's fee too — a cancelled trip earns GoMambo
      // nothing, so there's no commission left to keep. reverse_transfer
      // is required alongside it: this is a destination charge, so the
      // rental fee was already transferred to the owner's connected
      // account — without pulling it back, the platform balance may not
      // have the funds to cover the refund at all.
      refund_application_fee: true,
      reverse_transfer: true,
    });
    return { ok: true, data: { refundId: refund.id } };
  } catch (error) {
    return failure("refundCheckoutSession", error);
  }
}

// --- Security deposit (card-only manual-capture hold) --------------------
//
// BLIK — the dominant PL payment method — is single-use and doesn't
// support delayed capture, so the deposit can't share a Checkout Session
// with the rental fee above (which allows BLIK): it's a second, separate
// Checkout Session restricted to card, with the underlying PaymentIntent
// set to manual capture. Using Checkout here too (instead of a raw
// PaymentIntent) keeps both charges on the same "redirect to a
// Stripe-hosted page" flow — no custom Stripe Elements form to build.
// Known v1 gap: a manual-capture hold on a destination charge only lasts
// Stripe's standard ~7 days (request_extended_authorization errors out
// entirely on this account type instead of degrading gracefully, so it's
// deliberately not used here) — a deposit hold on a longer rental can
// expire before the trip ends. Not solved here, just not pretended away.

// Checkout doesn't hand back the underlying PaymentIntent id synchronously
// at session-creation time for a manual-capture session — it only exists
// once the customer actually reaches/completes checkout. So this returns
// just the session id/url; the webhook (checkout.session.completed, kind
// === "security_deposit") is what resolves and stores the real
// PaymentIntent id once Stripe has one.
export async function createDepositCheckoutSession(params: {
  bookingId: string;
  ownerStripeAccountId: string;
  depositAmountPln: number;
  renterEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeResult<{ sessionId: string; url: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: params.renterEmail,
      line_items: [
        {
          price_data: {
            currency: "pln",
            unit_amount: Math.round(params.depositAmountPln * 100),
            product_data: { name: "Kaucja zabezpieczająca" },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        transfer_data: { destination: params.ownerStripeAccountId },
      },
      metadata: { bookingId: params.bookingId, kind: "security_deposit" },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) {
      return { ok: false, error: "Stripe nie zwrócił adresu płatności kaucji." };
    }
    return { ok: true, data: { sessionId: session.id, url: session.url } };
  } catch (error) {
    return failure("createDepositCheckoutSession", error);
  }
}

export async function captureDeposit(
  paymentIntentId: string,
  amountToCapturePln?: number
): Promise<StripeResult<{ status: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const intent = await stripe.paymentIntents.capture(
      paymentIntentId,
      amountToCapturePln !== undefined
        ? { amount_to_capture: Math.round(amountToCapturePln * 100) }
        : undefined
    );
    return { ok: true, data: { status: intent.status } };
  } catch (error) {
    return failure("captureDeposit", error);
  }
}

export async function releaseDeposit(paymentIntentId: string): Promise<StripeResult<{ status: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const intent = await stripe.paymentIntents.cancel(paymentIntentId);
    return { ok: true, data: { status: intent.status } };
  } catch (error) {
    return failure("releaseDeposit", error);
  }
}

// --- Webhook signature verification --------------------------------------

export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event | null {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error("constructWebhookEvent: Stripe or webhook secret not configured.");
    return null;
  }
  try {
    return stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("constructWebhookEvent: signature verification failed", error);
    return null;
  }
}
