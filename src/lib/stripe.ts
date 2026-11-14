import "server-only";
import Stripe from "stripe";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Lazy singleton, null when unconfigured — same pattern as
// src/lib/face-match.ts. Every exported function below checks this first
// and returns a typed failure instead of throwing, so pages/actions that
// call into Stripe before the keys are configured degrade to "payments
// unavailable" instead of crashing.
//
// Every call is bounded: 20 s per attempt and one retry (the SDK reuses the
// idempotency key on it), so one call takes at most about 41 s instead of the
// SDK's default of 3 × 80 s. The deposit refund lease (REFUND_LEASE_MS in
// src/lib/deposit-service.ts) is sized against this budget.
const STRIPE_TIMEOUT_MS = 20_000;
const STRIPE_MAX_NETWORK_RETRIES = 1;
const stripe = SECRET_KEY
  ? new Stripe(SECRET_KEY, { timeout: STRIPE_TIMEOUT_MS, maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES })
  : null;

export function isStripeConfigured(): boolean {
  return stripe !== null;
}

/**
 * Which Stripe environment the secret key belongs to, read from its prefix —
 * the key itself never leaves the server. In "test" no real money moves, and
 * every Connect account created is a test account that will not exist once a
 * live key is set: asking owners to fill in Stripe's payout form now would
 * have them hand real identity and bank details to a sandbox, only to repeat
 * it later. So until the key is live, the payout step stays closed for
 * everyone but admins (see StripeConnectManager).
 */
export type StripeMode = "test" | "live" | "unknown" | "none";

export function stripeMode(): StripeMode {
  if (!SECRET_KEY) return "none";
  if (/^(sk|rk)_test_/.test(SECRET_KEY)) return "test";
  if (/^(sk|rk)_live_/.test(SECRET_KEY)) return "live";
  return "unknown";
}

export type StripeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// `code` is carried so callers can tell "this object no longer exists"
// (safe to move on) from "I couldn't reach Stripe" (must not assume
// anything) — the difference between a harmless retry and a second
// payable Checkout Session.
function failure<T>(context: string, error: unknown): StripeResult<T> {
  console.error(`${context}:`, error);
  const stripeError = error instanceof Stripe.errors.StripeError ? error : null;
  return {
    ok: false,
    error: stripeError?.message ?? "Nieznany błąd Stripe.",
    code: stripeError?.code,
  };
}

// --- Connect onboarding (owner payouts) ---------------------------------

export async function ensureConnectAccount(
  existingAccountId: string | null,
  email: string
): Promise<StripeResult<{ accountId: string; created: boolean }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    if (existingAccountId) {
      try {
        await stripe.accounts.retrieve(existingAccountId);
        return { ok: true, data: { accountId: existingAccountId, created: false } };
      } catch (error) {
        // An id saved under the other key — a test account once the live key
        // is set — does not exist here, and the owner needs a fresh one.
        // Anything else is a real failure: minting a second account for the
        // same owner on a network blip would orphan the first.
        const code = error instanceof Stripe.errors.StripeError ? error.code : undefined;
        if (code !== "resource_missing" && code !== "account_invalid") throw error;
      }
    }
    const account = await stripe.accounts.create({
      type: "express",
      country: "PL",
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    return { ok: true, data: { accountId: account.id, created: true } };
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

// `totalPricePln` is the GROSS amount the renter pays (owner's price plus
// the platform fee) and `platformFeePln` the fee inside it — see
// applyCommission in src/lib/pricing.ts. Stripe transfers the remainder to
// the owner, which is exactly their listed price.
export async function createRentalCheckoutSession(params: {
  bookingId: string;
  ownerStripeAccountId: string;
  totalPricePln: number;
  platformFeePln: number;
  description: string;
  renterEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<StripeResult<{ sessionId: string; url: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const feeCents = Math.round(params.platformFeePln * 100);
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
        // Omitted rather than sent as 0 on a 0% promo — the same shape as
        // the extra-charge session below, which also takes no cut.
        ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
        transfer_data: { destination: params.ownerStripeAccountId },
      },
      metadata: { bookingId: params.bookingId, ...params.metadata },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) return { ok: false, error: "Stripe nie zwrócił adresu płatności." };
    return { ok: true, data: { sessionId: session.id, url: session.url } };
  } catch (error) {
    return failure("createRentalCheckoutSession", error);
  }
}

// A damage claim above the held deposit, not a rental fee — 100% goes to
// the owner (no application_fee_amount) since GoMambo takes no cut of
// compensation for someone else's damage. Deliberately a fresh Checkout
// Session the renter must pay themselves, not an off-session charge: no
// Stripe Customer/PaymentMethod is ever saved (see createBookingCheckoutSession),
// and BLIK — Poland's dominant payment method — can't support one anyway.
export async function createExtraChargeCheckoutSession(params: {
  bookingId: string;
  extraChargeId: string;
  ownerStripeAccountId: string;
  amountPln: number;
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
            unit_amount: Math.round(params.amountPln * 100),
            product_data: { name: params.description },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        transfer_data: { destination: params.ownerStripeAccountId },
      },
      metadata: { bookingId: params.bookingId, kind: "extra_charge", extraChargeId: params.extraChargeId },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) return { ok: false, error: "Stripe nie zwrócił adresu płatności." };
    return { ok: true, data: { sessionId: session.id, url: session.url } };
  } catch (error) {
    return failure("createExtraChargeCheckoutSession", error);
  }
}

// A Checkout Session stays payable until it expires (~24h), so anything
// that replaces one — a retry, a cancellation — has to know whether the old
// one was already paid before deciding what to do with it.
export async function getCheckoutSessionPayment(sessionId: string): Promise<
  StripeResult<{
    status: string | null;
    paymentStatus: string | null;
    paymentIntentId: string | null;
    paymentIntentStatus: string | null;
    amountTotalPln: number | null;
    applicationFeePln: number | null;
  }>
> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    const intent =
      session.payment_intent && typeof session.payment_intent !== "string"
        ? session.payment_intent
        : null;
    return {
      ok: true,
      data: {
        status: session.status ?? null,
        paymentStatus: session.payment_status ?? null,
        paymentIntentId: intent?.id ?? null,
        // A "complete" session can still be unpaid (BLIK/async settling or
        // failed), so the intent's own status is what decides whether money
        // actually moved.
        paymentIntentStatus: intent?.status ?? null,
        amountTotalPln: session.amount_total !== null ? session.amount_total / 100 : null,
        applicationFeePln:
          intent?.application_fee_amount != null ? intent.application_fee_amount / 100 : null,
      },
    };
  } catch (error) {
    return failure("getCheckoutSessionPayment", error);
  }
}

// Kills an unpaid Session so it can't be completed later from a stale tab.
// Stripe only allows this while it's "open"; anything else is already
// resolved and the caller treats the rejection as "nothing to do".
export async function expireCheckoutSession(
  sessionId: string
): Promise<StripeResult<{ status: string | null }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const session = await stripe.checkout.sessions.expire(sessionId);
    return { ok: true, data: { status: session.status ?? null } };
  } catch (error) {
    return failure("expireCheckoutSession", error);
  }
}

/**
 * What a session's metadata must say before money goes back from it.
 *
 * Outside the webhook — where the session IS the event — the id to refund
 * is read from a database row, and a row is only as trustworthy as whoever
 * could write it. A renter once could insert a booking_extensions row
 * carrying the session id of a different, paid booking; cancelling then
 * refunded that booking in full while it stayed "paid". The insert policy is
 * gone (migration 0050), and this is the second lock: Stripe's own record of
 * what the session was created for has to agree with the row. `kind: null`
 * is the base rental payment, which is created without a kind.
 */
export type SessionOwnership = {
  bookingId: string;
  kind: "trip_extension" | "security_deposit" | null;
  extensionId?: string;
};

function sessionBelongsTo(
  metadata: Stripe.Metadata | null | undefined,
  expected: SessionOwnership
): boolean {
  if (metadata?.bookingId !== expected.bookingId) return false;
  if ((metadata?.kind ?? null) !== expected.kind) return false;
  if (expected.extensionId !== undefined && metadata?.extensionId !== expected.extensionId) {
    return false;
  }
  return true;
}

export async function refundCheckoutSession(
  sessionId: string,
  expected?: SessionOwnership
): Promise<StripeResult<{ refundId: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.latest_charge"],
    });
    if (expected && !sessionBelongsTo(session.metadata, expected)) {
      console.error("[stripe] refund refused: session metadata does not match", {
        sessionId,
        expected,
        metadata: session.metadata,
      });
      return {
        ok: false,
        error: `sesja ${sessionId} nie należy do tej rezerwacji (dane w Stripe się nie zgadzają) — zwrot wstrzymany, sprawdź to ręcznie`,
      };
    }
    // A deposit sits on the platform balance, not on the owner's account, so
    // the reverse_transfer below would be wrong for it — and a refund that
    // should be partial would be full. Deposits go back only through
    // refundDepositPayment.
    if (session.metadata?.kind === DEPOSIT_KIND) {
      return {
        ok: false,
        error: `sesja ${sessionId} to kaucja — zwrot kaucji idzie osobną ścieżką, sprawdź to ręcznie`,
      };
    }
    if (!session.payment_intent) return { ok: false, error: "Brak płatności do zwrotu." };
    const intent =
      typeof session.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent, {
            expand: ["latest_charge"],
          })
        : session.payment_intent;

    // Idempotent: Stripe redelivers webhooks for days, and several paths can
    // ask for the same refund. Re-asking Stripe would fail with "already
    // refunded" and fire a false "refund failed" alert at a human.
    const charge =
      intent.latest_charge && typeof intent.latest_charge !== "string"
        ? intent.latest_charge
        : null;
    if (charge?.refunded) {
      return { ok: true, data: { refundId: charge.refunds?.data?.[0]?.id ?? "already_refunded" } };
    }
    // Refund the platform's fee too — a cancelled trip earns GoMambo
    // nothing — but only when there IS one: Stripe rejects
    // refund_application_fee on a charge with no application fee ("...but it
    // has no application fee"), and 0%-promo rentals are created without
    // application_fee_amount. reverse_transfer stays unconditional: this is
    // a destination charge, the rental fee was already transferred to the
    // owner's connected account, and pulling it back is what funds the
    // refund at all.
    const hasApplicationFee = (intent.application_fee_amount ?? 0) > 0;
    const refund = await stripe.refunds.create({
      payment_intent: intent.id,
      ...(hasApplicationFee ? { refund_application_fee: true } : {}),
      reverse_transfer: true,
    });
    return { ok: true, data: { refundId: refund.id } };
  } catch (error) {
    return failure("refundCheckoutSession", error);
  }
}

// --- Security deposit (charged on the platform, settled after return) ----
//
// The custody model lives here and in src/lib/deposit-service.ts, nowhere
// else. Today the deposit is an ordinary, automatically captured payment on
// GoMambo's own balance: no transfer_data, no application fee. That is what
// lets it be paid with BLIK (which cannot be authorised now and captured
// later) and what lets it be returned without pulling money back from an
// owner who may already have been paid out. The kept part of a deposit goes
// to the owner afterwards as a separate transfer tied to this charge.
//
// Switching to a destination charge on the owner's account later means
// changing createDepositPaymentSession, refundDepositPayment and
// transferRetainedDeposit below — callers only ever say "take", "give back"
// and "pass on", never where the money sits.

export const DEPOSIT_KIND = "security_deposit";
export const DEPOSIT_REFUND_KIND = "security_deposit_refund";
export const DEPOSIT_RETENTION_KIND = "security_deposit_retention";

// Ties the deposit charge and any transfer of its kept part together in the
// Stripe dashboard, and is how a retry finds a transfer it already made.
export function depositTransferGroup(bookingId: string): string {
  return `booking_${bookingId}`;
}

// Two hours, not Stripe's default 24: a session that stays payable for a day
// is a second payment waiting to happen. Every new click closes the previous
// one anyway (settlePreviousSession), so a short life costs nothing.
const DEPOSIT_SESSION_TTL_SECONDS = 2 * 60 * 60;

const toGrosze = (pln: number) => Math.round(pln * 100);

export async function createDepositPaymentSession(params: {
  bookingId: string;
  depositPln: number;
  feePln: number;
  carLabel: string;
  renterEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeResult<{ sessionId: string; url: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const metadata = { bookingId: params.bookingId, kind: DEPOSIT_KIND };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card", "blik"],
      customer_email: params.renterEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "pln",
            unit_amount: toGrosze(params.depositPln),
            product_data: { name: `Kaucja zwrotna – ${params.carLabel}` },
          },
          quantity: 1,
        },
        ...(params.feePln > 0
          ? [
              {
                price_data: {
                  currency: "pln",
                  unit_amount: toGrosze(params.feePln),
                  product_data: { name: "Opłata za obsługę kaucji (bezzwrotna)" },
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      // On the PaymentIntent as well as the session: refund, dispute and
      // payment_intent.* events carry the intent, not the session, and this
      // is the only way they can be told apart from a rental payment.
      payment_intent_data: {
        transfer_group: depositTransferGroup(params.bookingId),
        metadata,
      },
      metadata,
      expires_at: Math.floor(Date.now() / 1000) + DEPOSIT_SESSION_TTL_SECONDS,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) return { ok: false, error: "Stripe nie zwrócił adresu płatności kaucji." };
    return { ok: true, data: { sessionId: session.id, url: session.url } };
  } catch (error) {
    return failure("createDepositPaymentSession", error);
  }
}

/**
 * The charge behind a deposit payment and how it was paid. The charge id is
 * what a transfer of the kept part has to name (source_transaction), and the
 * method decides what the renter is told about how long a refund takes.
 */
export async function getDepositCharge(
  paymentIntentId: string
): Promise<StripeResult<{ chargeId: string | null; paymentMethodType: string | null }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge =
      intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
    return {
      ok: true,
      data: {
        chargeId: charge?.id ?? (typeof intent.latest_charge === "string" ? intent.latest_charge : null),
        paymentMethodType: charge?.payment_method_details?.type ?? intent.payment_method_types?.[0] ?? null,
      },
    };
  } catch (error) {
    return failure("getDepositCharge", error);
  }
}

export type DepositRefundSummary = {
  /** Refunds that went through. */
  succeededPln: number;
  /** Refunds still on their way (BLIK can take up to two hours). */
  inFlightPln: number;
  /** The newest refund that failed or was cancelled, if any. */
  lastFailure: { refundId: string; reason: string | null } | null;
  /** True while the charge has an open dispute: Stripe refuses refunds then. */
  disputed: boolean;
};

/**
 * Stripe's own record of what has gone back on this payment. Every refund
 * decision compares against this instead of trusting a stored id, because
 * a deposit can be returned in more than one part and the events for those
 * parts arrive in any order.
 */
export async function getDepositRefunds(
  paymentIntentId: string
): Promise<StripeResult<DepositRefundSummary>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge =
      intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
    const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });

    let succeeded = 0;
    let inFlight = 0;
    let lastFailure: DepositRefundSummary["lastFailure"] = null;
    let lastFailureAt = -1;
    for (const refund of refunds.data) {
      if (refund.status === "succeeded") succeeded += refund.amount;
      else if (refund.status === "pending" || refund.status === "requires_action") inFlight += refund.amount;
      else if ((refund.status === "failed" || refund.status === "canceled") && refund.created > lastFailureAt) {
        lastFailureAt = refund.created;
        lastFailure = { refundId: refund.id, reason: refund.failure_reason ?? refund.status };
      }
    }
    return {
      ok: true,
      data: {
        succeededPln: succeeded / 100,
        inFlightPln: inFlight / 100,
        lastFailure,
        disputed: Boolean(charge?.disputed),
      },
    };
  } catch (error) {
    return failure("getDepositRefunds", error);
  }
}

/**
 * Sends `amountPln` of a deposit payment back to the renter.
 *
 * Refuses unless Stripe's record of the payment says it is this booking's
 * deposit — the same second lock as sessionBelongsTo: the intent id comes
 * from a database row, and a row is only as trustworthy as whoever wrote it.
 * The idempotency key makes a retried call a no-op instead of a second
 * refund; callers derive it from a counter they claim in the database.
 */
export async function refundDepositPayment(params: {
  paymentIntentId: string;
  /** Omitted: everything still refundable on the payment. */
  amountPln?: number;
  bookingId: string;
  idempotencyKey: string;
}): Promise<StripeResult<{ refundId: string; status: string | null }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const intent = await stripe.paymentIntents.retrieve(params.paymentIntentId);
    if (intent.metadata?.bookingId !== params.bookingId || intent.metadata?.kind !== DEPOSIT_KIND) {
      console.error("[stripe] deposit refund refused: intent metadata does not match", {
        paymentIntentId: params.paymentIntentId,
        bookingId: params.bookingId,
        metadata: intent.metadata,
      });
      return {
        ok: false,
        error: `płatność ${params.paymentIntentId} nie jest kaucją tej rezerwacji (dane w Stripe się nie zgadzają) — zwrot wstrzymany, sprawdź to ręcznie`,
      };
    }
    const refund = await stripe.refunds.create(
      {
        payment_intent: params.paymentIntentId,
        ...(params.amountPln !== undefined ? { amount: toGrosze(params.amountPln) } : {}),
        metadata: { bookingId: params.bookingId, kind: DEPOSIT_REFUND_KIND },
      },
      { idempotencyKey: params.idempotencyKey }
    );
    return { ok: true, data: { refundId: refund.id, status: refund.status ?? null } };
  } catch (error) {
    return failure("refundDepositPayment", error);
  }
}

/**
 * Passes the kept part of a deposit to the owner's Connect account.
 *
 * source_transaction ties the transfer to the deposit charge, so it waits
 * for those funds to become available instead of failing on a thin balance,
 * and can never exceed what the renter paid. Before creating anything it
 * looks for a transfer this booking already has: idempotency keys expire
 * after a day, a retry by the daily job may come later than that.
 */
export async function transferRetainedDeposit(params: {
  bookingId: string;
  chargeId: string;
  destinationAccountId: string;
  amountPln: number;
  idempotencyKey: string;
}): Promise<StripeResult<{ transferId: string; alreadyExisted: boolean }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const group = depositTransferGroup(params.bookingId);
    const existing = await stripe.transfers.list({ transfer_group: group, limit: 10 });
    const previous = existing.data.find(
      (transfer) =>
        transfer.metadata?.bookingId === params.bookingId &&
        transfer.metadata?.kind === DEPOSIT_RETENTION_KIND
    );
    if (previous) {
      return { ok: true, data: { transferId: previous.id, alreadyExisted: true } };
    }
    const transfer = await stripe.transfers.create(
      {
        amount: toGrosze(params.amountPln),
        currency: "pln",
        destination: params.destinationAccountId,
        source_transaction: params.chargeId,
        transfer_group: group,
        metadata: { bookingId: params.bookingId, kind: DEPOSIT_RETENTION_KIND },
      },
      { idempotencyKey: params.idempotencyKey }
    );
    return { ok: true, data: { transferId: transfer.id, alreadyExisted: false } };
  } catch (error) {
    return failure("transferRetainedDeposit", error);
  }
}

/**
 * The transfer of a kept amount this booking already has, if any. A call
 * that timed out may still have created one; before money that "failed" to
 * reach the owner is sent to the renter instead, this is what is checked.
 */
export async function findRetainedDepositTransfer(
  bookingId: string
): Promise<StripeResult<{ transferId: string; amountPln: number } | null>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const existing = await stripe.transfers.list({
      transfer_group: depositTransferGroup(bookingId),
      limit: 10,
    });
    const found = existing.data.find(
      (transfer) =>
        transfer.metadata?.bookingId === bookingId &&
        transfer.metadata?.kind === DEPOSIT_RETENTION_KIND
    );
    return {
      ok: true,
      data: found ? { transferId: found.id, amountPln: found.amount / 100 } : null,
    };
  } catch (error) {
    return failure("findRetainedDepositTransfer", error);
  }
}

/**
 * Takes a transferred amount back from the owner's Connect account. Only
 * works while the owner still has it on their Stripe balance — once paid out
 * to their bank, Stripe refuses and it becomes a matter for a human.
 */
export async function reverseDepositTransfer(params: {
  transferId: string;
  bookingId: string;
  idempotencyKey: string;
}): Promise<StripeResult<{ reversalId: string }>> {
  if (!stripe) return { ok: false, error: "Płatności nie są jeszcze skonfigurowane." };
  try {
    const reversal = await stripe.transfers.createReversal(
      params.transferId,
      { metadata: { bookingId: params.bookingId, kind: DEPOSIT_RETENTION_KIND } },
      { idempotencyKey: params.idempotencyKey }
    );
    return { ok: true, data: { reversalId: reversal.id } };
  } catch (error) {
    return failure("reverseDepositTransfer", error);
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
