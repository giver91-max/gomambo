import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BookingDeposit,
  BookingStatus,
  Database,
  DepositDecision,
  DepositState,
  PaymentStatus,
} from "@/types/database";
import {
  findRetainedDepositTransfer,
  getCheckoutSessionPayment,
  getDepositCharge,
  getDepositRefunds,
  refundDepositPayment,
  reverseDepositTransfer,
  transferRetainedDeposit,
  type DepositRefundSummary,
} from "@/lib/stripe";
import { settlePreviousSession } from "@/lib/checkout-session-state";
import { reportMoneyFailure } from "@/lib/money-alerts";
import { notifyUser } from "@/lib/notify-user";
import { notifyAdmins } from "@/lib/notify-admins";
import { sendPickupInstructionsIfDue } from "@/lib/pickup-instructions";
import {
  addDaysIso,
  formatDatePl,
  formatDateTimePl,
  startOfDayInPoland,
  todayInPoland,
} from "@/lib/calendar";
import {
  DEPOSIT_OBJECTION_DAYS,
  DEPOSIT_REQUEST_LEAD_DAYS,
  DEPOSIT_REVIEW_DAYS,
  DEPOSIT_STATE_LABELS,
  bookingDepositAmounts,
  decidableRetention,
  depositDueAt,
  depositDueText,
  formatZl,
  roundPln,
} from "@/lib/deposit";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";

// Every move of the security deposit. The rule for all of them is the one
// the rest of the money code follows: claim the transition with a
// conditional UPDATE … RETURNING first, and only the caller that got the row
// back may talk to Stripe. A webhook redelivered three times, the daily job
// and a double click therefore all end in one refund, one transfer, one mail.
//
// Where the money sits (GoMambo's balance today) is known only to the Stripe
// helpers in src/lib/stripe.ts; this file speaks of taking, returning and
// passing on.

type Admin = SupabaseClient<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows each daily-job step touches at most, to stay inside the 60 s limit. */
const CRON_BATCH = 20;

const nowIso = () => new Date().toISOString();

// Deadlines told to people as "do 17.11.2026, 15:00".
const deadlineText = (value: string | Date) => formatDateTimePl(value);

// How long a refund takes to show up, by how the deposit was paid.
function refundTimingSentence(paymentMethodType: string | null): string {
  if (paymentMethodType === "blik") return "Zwrot na BLIK dociera zwykle w ciągu 2 godzin.";
  if (paymentMethodType === "card") return "Zwrot na kartę pojawia się zwykle w ciągu 5–10 dni roboczych.";
  return "BLIK zwykle do 2 godzin, karta do 10 dni roboczych.";
}

// What the renter is promised about getting the deposit back. The deadline
// is when GoMambo ORDERS the refund; a card refund then still takes days to
// arrive, so the sentence never says the money is back by that date.
const DEPOSIT_RETURN_PROMISE = `Zwrot kaucji zlecimy od razu, gdy właściciel potwierdzi, że auto jest w porządku, a najpóźniej ${DEPOSIT_REVIEW_DAYS + 1} dni po zakończeniu wynajmu, jeśli nie zgłosi szkody. Pieniądze dotrą na BLIK zwykle w ciągu 2 godzin, na kartę do 10 dni roboczych.`;

type DepositBooking = {
  id: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  start_date: string;
  end_date: string;
  owner_id: string;
  renter_id: string;
  deposit_amount: number | null;
  deposit_fee_amount: number | null;
  carLabel: string;
  carDeposit: number | null;
};

async function loadBooking(
  admin: Admin,
  bookingId: string
): Promise<{ booking: DepositBooking | null; failed: boolean }> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      `id, status, payment_status, start_date, end_date, owner_id, renter_id,
       deposit_amount, deposit_fee_amount, cars(brand, model, year, security_deposit_amount)`
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) {
    console.error("[deposit] booking read failed", { bookingId, message: error.message });
    return { booking: null, failed: true };
  }
  if (!data) return { booking: null, failed: false };
  const car = data.cars as unknown as {
    brand: string;
    model: string;
    year: number;
    security_deposit_amount: number | null;
  } | null;
  return {
    booking: {
      id: data.id,
      status: data.status,
      payment_status: data.payment_status,
      start_date: data.start_date,
      end_date: data.end_date,
      owner_id: data.owner_id,
      renter_id: data.renter_id,
      deposit_amount: data.deposit_amount,
      deposit_fee_amount: data.deposit_fee_amount,
      carLabel: car ? `${car.brand} ${car.model} (${car.year})` : "auto",
      carDeposit: car?.security_deposit_amount ?? null,
    },
    failed: false,
  };
}

async function loadDeposit(
  admin: Admin,
  bookingId: string
): Promise<{ deposit: BookingDeposit | null; failed: boolean }> {
  const { data, error } = await admin
    .from("booking_deposits")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) {
    console.error("[deposit] deposit read failed", { bookingId, message: error.message });
    return { deposit: null, failed: true };
  }
  return { deposit: (data as BookingDeposit | null) ?? null, failed: false };
}

/**
 * Whether the handling fee goes back with a deposit whose booking is over.
 * Rafał's rule: yes when the owner or GoMambo called the booking off, no when
 * the renter did. Every cancellation the app makes records that on the
 * deposit (cancel_fee_refund) before it flips the booking's status. Without
 * a record: a cancelled booking was cancelled from the renter's own account
 * (since 0052 the database lets nobody else but the server do it), so the fee
 * stays; anything else — a deposit closed because the trip ended, a booking
 * that no longer exists — was never the renter's cancellation, so it goes back.
 */
function depositFeeComesBack(
  deposit: Pick<BookingDeposit, "cancel_fee_refund">,
  booking: Pick<DepositBooking, "status"> | null
): boolean {
  if (deposit.cancel_fee_refund !== null) return deposit.cancel_fee_refund;
  return booking?.status !== "cancelled";
}

/**
 * Records, BEFORE a booking is marked cancelled, whether its deposit's fee
 * goes back (see depositFeeComesBack). The first decision stands: a later
 * pass (the daily job's safety net) never overwrites what the cancelling
 * click decided. A booking with no deposit row yet simply has nothing to mark.
 */
export async function recordDepositCancellation(
  admin: Admin,
  bookingId: string,
  feeRefund: boolean
): Promise<void> {
  const { error } = await admin
    .from("booking_deposits")
    .update({ cancel_fee_refund: feeRefund })
    .eq("booking_id", bookingId)
    .is("cancel_fee_refund", null);
  if (error) {
    console.error("[deposit] recording the cancellation's fee decision failed", {
      bookingId,
      message: error.message,
    });
  }
}

/**
 * Whether an unpaid deposit is what still holds the pickup details back —
 * the same rule as sendPickupInstructionsIfDue — for the texts that promise
 * those details. Fails closed: when it can't tell, it says "still held",
 * so nobody is told "wszystko gotowe" too early.
 */
export async function depositHoldsPickup(admin: Admin, bookingId: string): Promise<boolean> {
  const { booking, failed } = await loadBooking(admin, bookingId);
  if (failed) return true;
  if (!booking) return false;
  const { amount } = bookingDepositAmounts(
    booking.deposit_amount,
    booking.deposit_fee_amount,
    booking.carDeposit
  );
  if (amount <= 0) return false;
  const { deposit, failed: depositFailed } = await loadDeposit(admin, bookingId);
  if (depositFailed) return true;
  return deposit?.status !== "paid";
}

// ─────────────────────────────────────────────────────────────
// Asking for it
// ─────────────────────────────────────────────────────────────

/**
 * Opens the deposit for one booking and asks the renter to pay it. Same
 * moment and same idempotency as requestVerificationIfDue: the row is keyed
 * on booking_id, so the daily job and a webhook calling this for the same
 * booking create one row and send one mail.
 *
 * Only for a booking that is confirmed AND paid: a rental payment that never
 * arrives (a failed BLIK) leaves no deposit to give back.
 *
 * Returns true only when THIS call created the row.
 */
export async function requestDepositIfDue(admin: Admin, bookingId: string): Promise<boolean> {
  const { booking } = await loadBooking(admin, bookingId);
  if (!booking) return false;
  if (booking.status !== "accepted" || booking.payment_status !== "paid") return false;

  const today = todayInPoland();
  // A trip that is already over has nothing left to secure.
  if (booking.end_date < today) return false;
  // Too far out — the daily job asks at the right time. A trip starting
  // sooner than that (booked or paid late) is asked straight away.
  if (booking.start_date > addDaysIso(today, DEPOSIT_REQUEST_LEAD_DAYS)) return false;

  const { amount, fee } = bookingDepositAmounts(
    booking.deposit_amount,
    booking.deposit_fee_amount,
    booking.carDeposit
  );
  if (amount <= 0) {
    // A booking made before the amounts were pinned, on a car that takes no
    // deposit: pinned at 0 now, at the moment it would have been asked, so
    // the daily job's query (which skips bookings pinned at 0) stops picking
    // it up — otherwise it would take a slot of every run until its trip ends.
    if (booking.deposit_amount === null) {
      await admin
        .from("bookings")
        .update({ deposit_amount: 0, deposit_fee_amount: 0 })
        .eq("id", bookingId)
        .is("deposit_amount", null);
    }
    return false;
  }

  // A booking made before the amounts were pinned at booking time gets them
  // pinned now, so every later screen and mail quotes what is being asked.
  if (booking.deposit_amount === null || booking.deposit_fee_amount === null) {
    await admin
      .from("bookings")
      .update({ deposit_amount: amount, deposit_fee_amount: fee })
      .eq("id", bookingId);
  }

  // The end of the day before pickup — or, for a trip asked late, a real
  // window from now (depositDueAt): the owner may cancel for non-payment
  // only after it.
  const dueAt = depositDueAt(booking.start_date, new Date());
  const { data: created } = await admin
    .from("booking_deposits")
    .insert({
      booking_id: bookingId,
      amount,
      fee_amount: fee,
      status: "requested",
      due_at: dueAt.toISOString(),
    })
    .select("booking_id")
    .maybeSingle();
  if (!created) return false;

  const dueText = depositDueText(booking.start_date, dueAt, today);
  const labelHtml = escapeHtml(booking.carLabel);

  await notifyUser({
    userId: booking.renter_id,
    type: "deposit_requested",
    subject: `Wpłać kaucję przed odbiorem: ${booking.carLabel}`,
    body: `Kaucja za ${booking.carLabel}: ${formatZl(amount)} zwrotne + ${formatZl(fee)} opłaty za obsługę kaucji. Wpłać ją kartą lub BLIK-iem ${dueText} — bez kaucji nie wyślemy danych do odbioru.`,
    emailHtml: `
      <p>Zbliża się Twój wynajem, więc prosimy o kaucję.</p>
      <ul>
        <li><strong>Auto:</strong> ${labelHtml}</li>
        <li><strong>Termin wynajmu:</strong> ${booking.start_date} – ${booking.end_date}</li>
        <li><strong>Kaucja zwrotna:</strong> ${formatZl(amount)}</li>
        <li><strong>Opłata za obsługę kaucji (bezzwrotna):</strong> ${formatZl(fee)}</li>
        <li><strong>Razem do wpłaty:</strong> ${formatZl(amount + fee)}</li>
        <li><strong>Termin wpłaty:</strong> ${dueText}</li>
      </ul>
      <p>Wpłacisz ją kartą lub BLIK-iem. Bez wpłaconej kaucji nie wyślemy Ci danych do odbioru auta.</p>
      <p>${DEPOSIT_RETURN_PROMISE}</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Wpłać kaucję →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  // Asked on pickup day itself (or later) — a trip booked or paid late. The
  // daily alarm only covers deposits asked for before that day, so it would
  // reach the owner after the pickup; the owner hears it now instead. Not
  // "nie wpłacił": the renter was asked a moment ago and has until dueAt.
  if (booking.start_date <= today) {
    const pickup = booking.start_date === today ? "Odbiór jest już dziś" : "Wynajem już trwa";
    const dueWhen = deadlineText(dueAt);
    await notifyUser({
      userId: booking.owner_id,
      type: "deposit_overdue",
      subject: `Nie wydawaj auta bez kaucji: ${booking.carLabel}`,
      body: `${pickup}, a o kaucję za ${booking.carLabel} poprosiliśmy najemcę przed chwilą. Nie wydawaj auta, dopóki jej nie wpłaci — dostaniesz wiadomość. Jeśli nie wpłaci do ${dueWhen}, możesz odwołać rezerwację z powodu braku kaucji.`,
      emailHtml: `
        <p><strong>Nie wydawaj auta, dopóki najemca nie wpłaci kaucji.</strong></p>
        <ul>
          <li><strong>Auto:</strong> ${labelHtml}</li>
          <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
          <li><strong>Kaucja:</strong> ${formatZl(amount)}</li>
        </ul>
        <p>${pickup}, a o kaucję poprosiliśmy najemcę przed chwilą. Gdy ją wpłaci, od razu dostaniesz wiadomość, a najemca dane do odbioru.</p>
        <p>Jeśli nie wpłaci jej do <strong>${dueWhen}</strong>, w panelu rezerwacji możesz odwołać rezerwację z powodu niewpłaconej kaucji. Liczy się to jak anulowanie przez najemcę — zwrot za wynajem według polityki anulowania auta.</p>
        <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
      `,
      link: "/dashboard/bookings",
    });
  }

  return true;
}

// ─────────────────────────────────────────────────────────────
// Paying it
// ─────────────────────────────────────────────────────────────

export type DepositPaymentOutcome =
  | "paid"
  | "already_recorded"
  | "refunded_late"
  | "refunded_duplicate"
  | "retry";

/**
 * A deposit payment that Stripe says has settled — from the webhook, or
 * found by a click or a cancellation when the webhook never came.
 *
 * "retry" means a database read or write failed: the webhook answers 500 so
 * Stripe delivers the event again, instead of a 200 that would lose it.
 */
export async function handleDepositPayment(
  admin: Admin,
  payment: {
    bookingId: string;
    sessionId: string;
    paymentIntentId: string;
    amountTotalPln: number | null;
  },
  attempt = 0
): Promise<DepositPaymentOutcome> {
  // The booking first, then the deposit: a cancellation records on the
  // deposit whether the fee goes back (cancel_fee_refund) BEFORE it marks
  // the booking cancelled, so a booking read as cancelled here guarantees
  // the deposit read after it already carries that decision.
  const { booking, failed: bookingFailed } = await loadBooking(admin, payment.bookingId);
  if (bookingFailed) return "retry";
  const { deposit, failed: depositFailed } = await loadDeposit(admin, payment.bookingId);
  if (depositFailed) return "retry";

  if (!deposit) {
    // Nothing here expects this money — typically the booking was deleted
    // while the renter still had the payment page open. All of it goes back.
    await refundUntrackedPayment(payment, null, "untracked");
    return "refunded_duplicate";
  }

  const open = deposit.status === "requested" || deposit.status === "processing";
  if (!open) {
    if (deposit.stripe_payment_intent_id === payment.paymentIntentId) return "already_recorded";
    // A deposit voided before anything was paid, now paid from a stale tab.
    if (!(deposit.status === "voided" && !deposit.stripe_payment_intent_id)) {
      // Paid twice: a second session stayed alive. The second payment is not
      // the deposit, so it goes back whole.
      await refundUntrackedPayment(payment, booking, "duplicate");
      return "refunded_duplicate";
    }
  }

  const now = nowIso();
  const paidAmount =
    payment.amountTotalPln ?? roundPln(Number(deposit.amount) + Number(deposit.fee_amount));

  const bookingIsOver =
    !booking || booking.status === "cancelled" || booking.status === "declined";
  if (bookingIsOver || deposit.status === "voided") {
    // The booking was called off (or its deposit closed) before this landed
    // — a late BLIK, a stale tab. There is nothing left to secure, so the
    // deposit goes back; the fee follows Rafał's rule (depositFeeComesBack):
    // back when the owner or GoMambo cancelled, kept when the renter did.
    // requested/processing/voided rows never carry a different settled
    // payment (a failed BLIK clears its intent id), so this payment simply
    // becomes the one on record.
    const feeBack = depositFeeComesBack(deposit, booking);
    const fee = Number(deposit.fee_amount);
    const back = feeBack ? paidAmount : roundPln(Math.max(0, paidAmount - fee));
    const { data: claimed, error } = await admin
      .from("booking_deposits")
      .update({
        status: "settled",
        decision: "late_payment",
        decided_at: now,
        stripe_checkout_session_id: payment.sessionId,
        stripe_payment_intent_id: payment.paymentIntentId,
        paid_amount: paidAmount,
        paid_at: now,
        refund_amount: roundPln(Number(deposit.refund_amount) + back),
        refund_status: "pending",
        refund_requested_at: now,
      })
      .eq("booking_id", payment.bookingId)
      .in("status", ["requested", "processing", "voided"])
      .select("booking_id")
      .maybeSingle();
    if (error) return "retry";
    if (!claimed) {
      return attempt === 0 ? handleDepositPayment(admin, payment, 1) : "already_recorded";
    }
    await pushDepositRefund(admin, payment.bookingId);
    if (booking) {
      const what = feeBack
        ? `całą wpłatę (${formatZl(paidAmount)})`
        : `kaucję ${formatZl(back)} — opłata za obsługę kaucji (${formatZl(fee)}) nie podlega zwrotowi przy anulowaniu przez najemcę`;
      const reason = bookingIsOver
        ? "po anulowaniu rezerwacji"
        : "już po rozliczeniu tej rezerwacji, gdy kaucja nie była już potrzebna";
      await notifyUser({
        userId: booking.renter_id,
        type: "deposit_refunded",
        subject: `Zwracamy wpłaconą kaucję: ${booking.carLabel}`,
        body: `Kaucja za ${booking.carLabel} wpłynęła ${reason}, więc zwracamy ${what}.`,
        emailHtml: `
          <p>Wpłata kaucji za <strong>${escapeHtml(booking.carLabel)}</strong> dotarła ${reason}.</p>
          <p>Zwracamy ${escapeHtml(what)}. BLIK zwykle do 2 godzin, karta do 10 dni roboczych. Nie musisz nic robić.</p>
          <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwacje →</a></p>
        `,
        link: "/dashboard/rentals",
      });
    }
    return "refunded_late";
  }

  const { data: claimed, error: claimError } = await admin
    .from("booking_deposits")
    .update({
      status: "paid",
      stripe_checkout_session_id: payment.sessionId,
      stripe_payment_intent_id: payment.paymentIntentId,
      paid_amount: paidAmount,
      paid_at: now,
    })
    .eq("booking_id", payment.bookingId)
    .in("status", ["requested", "processing"])
    .select("booking_id")
    .maybeSingle();
  if (claimError) return "retry";
  if (!claimed) {
    // Lost a race with another delivery of the same payment (or a
    // cancellation). Look again once and classify from the new state.
    return attempt === 0 ? handleDepositPayment(admin, payment, 1) : "already_recorded";
  }

  // Which charge and which method — needed later for the transfer of a kept
  // part and for what the renter is told about refund timing. Not worth
  // failing the payment over: both are fetched again when needed.
  const charge = await getDepositCharge(payment.paymentIntentId);
  if (charge.ok) {
    await admin
      .from("booking_deposits")
      .update({
        stripe_charge_id: charge.data.chargeId,
        payment_method_type: charge.data.paymentMethodType,
      })
      .eq("booking_id", payment.bookingId);
  }

  // The booking once more, now that the payment is on record. A cancellation
  // that ran between the first read above and the claim saw this deposit
  // still unpaid ("processing"), so it left the money to whoever records the
  // payment — this call. It flips the booking before it reads the deposit,
  // so a read made after the claim sees the cancellation. A failed read
  // leaves the first one standing; if the booking was in fact called off,
  // the daily job (reconcileDeposits, step 5) returns the deposit by the
  // rule the cancellation recorded.
  const { booking: current, failed: currentFailed } = await loadBooking(admin, payment.bookingId);
  if (!currentFailed && (!current || current.status === "cancelled" || current.status === "declined")) {
    return returnDepositPaidAfterCancellation(admin, payment.bookingId, current);
  }
  const live = currentFailed ? booking : current;

  if (live) {
    const amount = Number(deposit.amount);
    // Paid only after the rental was over — the owner ended it, or its last
    // day has passed (a page opened late on the last evening, paid after
    // midnight). No pickup details are coming for it; the owner's review
    // window opens right away instead.
    const tripOver = live.status === "completed" || live.end_date < todayInPoland();
    await notifyUser({
      userId: live.owner_id,
      type: "deposit_paid",
      subject: `Kaucja wpłacona: ${live.carLabel}`,
      body: `Najemca wpłacił kaucję ${formatZl(amount)} za ${live.carLabel} (${live.start_date} – ${live.end_date}). Trzymamy ją do rozliczenia po zwrocie auta.`,
      emailHtml: `
        <p>Najemca wpłacił kaucję za <strong>${escapeHtml(live.carLabel)}</strong> (${live.start_date} – ${live.end_date}).</p>
        <p><strong>Kaucja:</strong> ${formatZl(amount)}. GoMambo przechowuje ją do rozliczenia po zwrocie auta — wtedy potwierdzisz, że auto jest w porządku, albo zatrzymasz część na szkodę.</p>
        <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
      `,
      link: "/dashboard/bookings",
    });
    // "The day before" only while that day is still ahead: a deposit paid
    // the day before pickup, on pickup day or during the trip releases the
    // details right away (sendPickupInstructionsIfDue below).
    const pickupLine = tripOver
      ? null
      : live.start_date > addDaysIso(todayInPoland(), 1)
        ? "Dane do odbioru (numer rejestracyjny, miejsce, kontakt) wyślemy dzień przed terminem, gdy będzie potwierdzona także Twoja tożsamość."
        : "Dane do odbioru (numer rejestracyjny, miejsce, kontakt) wysyłamy osobną wiadomością — od razu, jeśli Twoja tożsamość jest już potwierdzona.";
    await notifyUser({
      userId: live.renter_id,
      type: "deposit_paid",
      subject: `Kaucja wpłacona: ${live.carLabel}`,
      body: `Kaucja ${formatZl(amount)} za ${live.carLabel} wpłacona — wróci po zwrocie auta.${pickupLine ? ` ${pickupLine}` : ""}`,
      emailHtml: `
        <p>Dziękujemy — kaucja za <strong>${escapeHtml(live.carLabel)}</strong> jest wpłacona.</p>
        <p><strong>${formatZl(amount)}</strong> wróci do Ciebie po zwrocie auta. ${DEPOSIT_RETURN_PROMISE}</p>
        ${pickupLine ? `<p>${pickupLine}</p>` : ""}
        <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
      `,
      link: "/dashboard/rentals",
    });

    if (tripOver) {
      // The review clock starts now, so the owner still gets the full
      // window — the deposit could not be settled before it was on record.
      await startDepositReview(admin, payment.bookingId, "owner");
    } else {
      // The deposit was the last thing holding the pickup details back.
      await sendPickupInstructionsIfDue(admin, payment.bookingId);
    }
  }

  return "paid";
}

/**
 * A deposit payment recorded as "paid" for a booking that, as it turned out
 * right after, had been called off meanwhile. Returned at once by the
 * cancellation's own rule (settleDepositOnCancellation, fee by
 * depositFeeComesBack) instead of being held for a trip that will not
 * happen. If the cancellation reached the deposit first and settled it
 * itself, the claim there fails here and nothing is sent twice.
 */
async function returnDepositPaidAfterCancellation(
  admin: Admin,
  bookingId: string,
  booking: DepositBooking | null
): Promise<DepositPaymentOutcome> {
  // Read after the booking: the fee decision is recorded before the flip.
  const { deposit: fresh, failed } = await loadDeposit(admin, bookingId);
  // Already "paid" on record — never "retry" from here (a redelivery would
  // only find it recorded). The daily job settles it if this read failed.
  if (failed || !fresh) return "paid";
  const result = await settleDepositOnCancellation(admin, bookingId, {
    includeFee: depositFeeComesBack(fresh, booking),
  });
  if (booking && (result.outcome === "refunded" || result.outcome === "refund_failed")) {
    const sentence = renterDepositSentence(result).trim();
    const timing =
      result.outcome === "refunded"
        ? " BLIK zwykle do 2 godzin, karta do 10 dni roboczych. Nie musisz nic robić."
        : "";
    await notifyUser({
      userId: booking.renter_id,
      type: "deposit_refunded",
      subject: `Zwracamy wpłaconą kaucję: ${booking.carLabel}`,
      body: `Kaucja za ${booking.carLabel} wpłynęła po anulowaniu rezerwacji. ${sentence}`,
      emailHtml: `
        <p>Wpłata kaucji za <strong>${escapeHtml(booking.carLabel)}</strong> dotarła po anulowaniu rezerwacji.</p>
        <p>${escapeHtml(sentence)}${timing}</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwacje →</a></p>
      `,
      link: "/dashboard/rentals",
    });
  }
  return "refunded_late";
}

/**
 * A payment that no row accounts for — a second payment of the same deposit,
 * or one for a booking that no longer exists. It is returned whole; the key
 * is per payment, so redeliveries of the same event refund it once.
 */
async function refundUntrackedPayment(
  payment: { bookingId: string; paymentIntentId: string; amountTotalPln: number | null },
  booking: DepositBooking | null,
  reason: "duplicate" | "untracked"
): Promise<void> {
  const result = await refundDepositPayment({
    paymentIntentId: payment.paymentIntentId,
    ...(payment.amountTotalPln !== null ? { amountPln: payment.amountTotalPln } : {}),
    bookingId: payment.bookingId,
    idempotencyKey: `deposit-untracked-refund:${payment.paymentIntentId}`,
  });
  if (!result.ok) {
    await reportMoneyFailure(
      "deposit_refund_failed",
      reason === "duplicate"
        ? `Kaucja do rezerwacji ${payment.bookingId} została wpłacona po raz drugi (płatność ${payment.paymentIntentId}), a automatyczny zwrot tej drugiej wpłaty się nie powiódł (${result.error}). Zwróć ją ręcznie w Stripe.`
        : `Wpłynęła kaucja (płatność ${payment.paymentIntentId}) do rezerwacji ${payment.bookingId}, której nie ma już w bazie, a automatyczny zwrot się nie powiódł (${result.error}). Zwróć ją ręcznie w Stripe.`
    );
    return;
  }
  if (booking && reason === "duplicate") {
    await notifyUser({
      userId: booking.renter_id,
      type: "deposit_refunded",
      subject: `Zwracamy podwójną wpłatę kaucji: ${booking.carLabel}`,
      body: `Kaucja za ${booking.carLabel} wpłynęła dwa razy — drugą wpłatę zwracamy w całości.`,
      emailHtml: `
        <p>Kaucja za <strong>${escapeHtml(booking.carLabel)}</strong> wpłynęła dwa razy. Drugą wpłatę zwracamy w całości — nie musisz nic robić.</p>
        <p>BLIK zwykle do 2 godzin, karta do 10 dni roboczych.</p>
      `,
      link: "/dashboard/rentals",
    });
  }
}

/**
 * BLIK: the renter finished checkout, the money is still on its way. Nothing
 * is released on this — only the payment itself (handleDepositPayment) does.
 *
 * Only for an intent Stripe still reports as on its way (the webhook checks
 * that first): a "completed" event can arrive after the failure it belongs
 * to, and a dead payment parked here would block the renter's next attempt.
 */
export async function markDepositProcessing(
  admin: Admin,
  payment: { bookingId: string; sessionId: string; paymentIntentId: string }
): Promise<"ok" | "retry"> {
  const { error } = await admin
    .from("booking_deposits")
    .update({
      status: "processing",
      stripe_checkout_session_id: payment.sessionId,
      stripe_payment_intent_id: payment.paymentIntentId,
    })
    .eq("booking_id", payment.bookingId)
    .eq("status", "requested");
  return error ? "retry" : "ok";
}

/**
 * The async payment never arrived. Back to "please pay", unless the booking
 * died or the rental ended in the meantime — then there is nothing left to
 * ask for, and the deposit is voided without a mail. Notifies
 * only from the call that actually flipped the row, so the two events that
 * report the same failure (checkout.session.async_payment_failed and
 * payment_intent.payment_failed) produce one mail.
 */
export async function markDepositPaymentFailed(
  admin: Admin,
  payment: { bookingId: string; paymentIntentId: string | null }
): Promise<"ok" | "retry"> {
  let query = admin
    .from("booking_deposits")
    .update({ status: "requested", stripe_payment_intent_id: null })
    .eq("booking_id", payment.bookingId)
    .eq("status", "processing");
  if (payment.paymentIntentId) {
    query = query.or(
      `stripe_payment_intent_id.is.null,stripe_payment_intent_id.eq.${payment.paymentIntentId}`
    );
  }
  const { data: flipped, error } = await query
    .select("booking_id, stripe_checkout_session_id")
    .maybeSingle();
  if (error) return "retry";
  if (!flipped) return "ok";

  const { booking } = await loadBooking(admin, payment.bookingId);
  if (!booking) return "ok";
  // Nothing left to ask for: the booking was called off, or the rental is
  // over (the owner ended it, or its last day has passed). payDeposit
  // refuses those, so "Spróbuj ponownie" would send the renter to a button
  // that is not there; the deposit is closed quietly instead — the failed
  // payment took no money. Bound to the page whose payment just failed, so a
  // page opened since then is closed by whoever closes the deposit next.
  if (booking.status !== "accepted" || booking.end_date < todayInPoland()) {
    await voidRequestedDeposit(admin, payment.bookingId, flipped.stripe_checkout_session_id);
    return "ok";
  }

  await notifyUser({
    userId: booking.renter_id,
    type: "payment_failed",
    subject: `Wpłata kaucji nie powiodła się: ${booking.carLabel}`,
    body: `Wpłata kaucji za ${booking.carLabel} nie doszła do skutku i nie pobraliśmy żadnych środków. Spróbuj ponownie — bez kaucji nie wyślemy danych do odbioru.`,
    emailHtml: `
      <p>Wpłata kaucji za <strong>${escapeHtml(booking.carLabel)}</strong> nie doszła do skutku — nie pobraliśmy żadnych środków.</p>
      <p>Spróbuj ponownie w panelu. Bez wpłaconej kaucji nie wyślemy Ci danych do odbioru auta.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Wpłać kaucję →</a></p>
    `,
    link: "/dashboard/rentals",
  });
  return "ok";
}

/**
 * Asks Stripe what became of a deposit sitting in "processing" and records
 * it: settled → handleDepositPayment, failed → back to "requested". Shared by
 * the daily safety net and the renter's own "Wpłać kaucję" click, so a
 * payment whose failure was reported before its "completed" event can never
 * keep the deposit unpayable until the next day.
 */
export async function resolveProcessingDeposit(
  admin: Admin,
  deposit: Pick<BookingDeposit, "booking_id" | "stripe_checkout_session_id" | "stripe_payment_intent_id">
): Promise<"paid" | "failed" | "processing" | "unknown"> {
  if (!deposit.stripe_checkout_session_id) return "unknown";
  const state = await getCheckoutSessionPayment(deposit.stripe_checkout_session_id);
  if (!state.ok) return "unknown";
  const paid = state.data.paymentStatus === "paid" || state.data.paymentIntentStatus === "succeeded";
  if (paid && state.data.paymentIntentId) {
    const outcome = await handleDepositPayment(admin, {
      bookingId: deposit.booking_id,
      sessionId: deposit.stripe_checkout_session_id,
      paymentIntentId: state.data.paymentIntentId,
      amountTotalPln: state.data.amountTotalPln,
    });
    return outcome === "retry" ? "unknown" : "paid";
  }
  if (
    state.data.paymentIntentStatus === "requires_payment_method" ||
    state.data.paymentIntentStatus === "canceled"
  ) {
    const outcome = await markDepositPaymentFailed(admin, {
      bookingId: deposit.booking_id,
      paymentIntentId: deposit.stripe_payment_intent_id,
    });
    return outcome === "retry" ? "unknown" : "failed";
  }
  return "processing";
}

/**
 * Makes sure the deposit's payment page can no longer be paid, before
 * something decides the deposit is not coming. If it turns out it WAS paid
 * (the webhook just hasn't arrived), that payment is recorded right here.
 */
export async function closeDepositSession(
  admin: Admin,
  deposit: Pick<BookingDeposit, "booking_id" | "stripe_checkout_session_id">
): Promise<"clear" | "paid" | "blocked"> {
  const previous = await settlePreviousSession(deposit.stripe_checkout_session_id);
  if (previous.kind === "blocked") return "blocked";
  if (previous.kind === "clear") return "clear";
  if (!previous.paymentIntentId) return "blocked";
  const outcome = await handleDepositPayment(admin, {
    bookingId: deposit.booking_id,
    sessionId: previous.sessionId,
    paymentIntentId: previous.paymentIntentId,
    amountTotalPln: previous.amountTotalPln,
  });
  return outcome === "retry" ? "blocked" : "paid";
}

/**
 * Voids a deposit that was never paid — only while it still names the
 * payment page the caller just closed (closeDepositSession) or saw fail. The
 * same condition payDeposit's compare-and-set records a new page under, so
 * exactly one of the two wins: a page opened in between is never left
 * payable behind a voided deposit. Returns whether this call voided it.
 */
async function voidRequestedDeposit(
  admin: Admin,
  bookingId: string,
  sessionId: string | null
): Promise<boolean> {
  const query = admin
    .from("booking_deposits")
    .update({ status: "voided" })
    .eq("booking_id", bookingId)
    .eq("status", "requested");
  const { data } = await (sessionId
    ? query.eq("stripe_checkout_session_id", sessionId)
    : query.is("stripe_checkout_session_id", null)
  )
    .select("booking_id")
    .maybeSingle();
  return Boolean(data);
}

// ─────────────────────────────────────────────────────────────
// Giving it back
// ─────────────────────────────────────────────────────────────

type MoneyResult = { ok: true } | { ok: false; error: string };

/**
 * How long one push holds a deposit's refund leg. The holder renews it in
 * the same write that claims an attempt, right before refundDepositPayment,
 * and from there makes two Stripe calls (each bounded to about 41 s, see
 * src/lib/stripe.ts) and one write — well inside this, so no second caller
 * can take the leg while the holder may still create a refund.
 */
const REFUND_LEASE_MS = 5 * 60 * 1000;
/** A caller that finds the leg held tries this many times, this far apart. */
const REFUND_LEASE_TRIES = 4;
const REFUND_LEASE_WAIT_MS = 750;
/** Passes a lease holder makes when the amount to return keeps rising under it. */
const REFUND_PUSH_ROUNDS = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends back whatever the row says is owed and Stripe has not been asked for
 * yet. The target (refund_amount) is always raised by a claim BEFORE this
 * runs; this only closes the gap between it and Stripe's own list of refunds
 * on the payment.
 *
 * One push at a time per deposit: a caller first takes a short lease on the
 * row (refund_lock_until), and only the holder lists Stripe's refunds, sends
 * the gap and records the result — two callers listing before either refund
 * existed would otherwise both send the same gap. The result is written only
 * while the target is still the one that was sent: a claim that raised it
 * meanwhile sends the holder round again for the difference, instead of a
 * "succeeded" that hides the gap from every later check. A crash or a retry
 * finds its earlier refunds in Stripe's list, so no złoty goes back twice.
 */
async function pushDepositRefund(admin: Admin, bookingId: string): Promise<MoneyResult> {
  const taken = await takeRefundLease(admin, bookingId);
  if (taken === "missing") return { ok: false, error: "brak kaucji w bazie" };
  if (taken === "error") return { ok: false, error: "nie udało się zapisać zwrotu w bazie" };
  // Another push holds this deposit. What this caller's claim added is sent
  // by that one: its final write misses a target that moved, and it goes
  // round again. Should it die instead, the row stays "pending" and the
  // daily job's check of stale refunds (reconcileDeposits, step 1) sends it.
  if (taken === "held") return { ok: true };

  let deposit = taken.deposit;
  // The lease as it stands in the row: pushRefundRound renews it before each
  // refund it sends, and every later write and the release match the renewed value.
  const held = { lease: taken.lease };
  try {
    for (let round = 0; round < REFUND_PUSH_ROUNDS; round += 1) {
      const outcome = await pushRefundRound(admin, deposit, held);
      if (outcome !== "target_moved") return outcome;
      const { deposit: reloaded } = await loadDeposit(admin, bookingId);
      if (!reloaded) return { ok: false, error: "nie udało się odczytać kaucji" };
      deposit = reloaded;
    }
    // Still rising after several passes: left "pending" by the claims that
    // raised it, for the daily job's check of stale refunds.
    return { ok: true };
  } finally {
    await releaseRefundLease(admin, bookingId, held.lease);
  }
}

async function takeRefundLease(
  admin: Admin,
  bookingId: string
): Promise<{ deposit: BookingDeposit; lease: string } | "held" | "missing" | "error"> {
  let failed = false;
  for (let tryNo = 1; ; tryNo += 1) {
    const now = new Date();
    const lease = new Date(now.getTime() + REFUND_LEASE_MS).toISOString();
    const { data, error } = await admin
      .from("booking_deposits")
      .update({ refund_lock_until: lease })
      .eq("booking_id", bookingId)
      .or(`refund_lock_until.is.null,refund_lock_until.lt."${now.toISOString()}"`)
      .select("*")
      .maybeSingle();
    if (data) return { deposit: data as BookingDeposit, lease };
    failed = Boolean(error);
    if (error) {
      console.error("[deposit] refund lease claim failed", { bookingId, message: error.message });
    }
    if (tryNo >= REFUND_LEASE_TRIES) break;
    await sleep(REFUND_LEASE_WAIT_MS);
  }
  if (failed) return "error";
  const { deposit, failed: readFailed } = await loadDeposit(admin, bookingId);
  if (readFailed) return "error";
  return deposit ? "held" : "missing";
}

async function releaseRefundLease(admin: Admin, bookingId: string, lease: string): Promise<void> {
  // Only this holder's own lease: one that ran out may already be someone else's.
  await admin
    .from("booking_deposits")
    .update({ refund_lock_until: null })
    .eq("booking_id", bookingId)
    .eq("refund_lock_until", lease);
}

/**
 * One pass of a lease holder: compare the row's target with Stripe's list,
 * send the gap, record it. "target_moved" when the row changed under it
 * (nothing recorded) — the caller reloads and goes round again.
 */
async function pushRefundRound(
  admin: Admin,
  deposit: BookingDeposit,
  held: { lease: string }
): Promise<MoneyResult | "target_moved"> {
  const bookingId = deposit.booking_id;
  const intentId = deposit.stripe_payment_intent_id;
  if (!intentId) {
    await markRefundFailed(admin, deposit, "brak identyfikatora płatności kaucji w bazie");
    return { ok: false, error: "brak identyfikatora płatności kaucji" };
  }

  const summary = await getDepositRefunds(intentId);
  if (!summary.ok) {
    await markRefundFailed(admin, deposit, summary.error);
    return { ok: false, error: summary.error };
  }

  const target = Number(deposit.refund_amount);
  const covered = summary.data.succeededPln + summary.data.inFlightPln;
  const outstanding = roundPln(target - covered);
  if (outstanding <= 0) {
    return (await applyRefundSummary(admin, deposit, summary.data, held.lease)) ? { ok: true } : "target_moved";
  }
  if (summary.data.disputed) {
    // Stripe refuses refunds on a disputed charge; the bank's decision says
    // where this money goes, and an admin settles the rest afterwards.
    await markRefundFailed(
      admin,
      deposit,
      "płatność objęta sporem w banku — zwrot wstrzymany do jego rozstrzygnięcia",
      false
    );
    return { ok: false, error: "płatność objęta sporem w banku" };
  }

  // The lease keeps every other caller out; the counter only makes each
  // attempt's idempotency key unique (a retry after a failure is a new
  // request, a retried HTTP call of the same attempt is not). The same write
  // renews the lease — only while it is still this holder's — so the time
  // spent listing refunds above does not eat into the time the refund below
  // may take.
  const renewed = new Date(Date.now() + REFUND_LEASE_MS).toISOString();
  const { data: attempt } = await admin
    .from("booking_deposits")
    .update({ refund_attempts: deposit.refund_attempts + 1, refund_lock_until: renewed })
    .eq("booking_id", bookingId)
    .eq("refund_attempts", deposit.refund_attempts)
    .eq("refund_lock_until", held.lease)
    .select("refund_attempts")
    .maybeSingle();
  if (!attempt) return "target_moved";
  held.lease = renewed;

  const result = await refundDepositPayment({
    paymentIntentId: intentId,
    amountPln: outstanding,
    bookingId,
    idempotencyKey: `deposit-refund:${bookingId}:${attempt.refund_attempts}`,
  });
  if (!result.ok) {
    await markRefundFailed(admin, deposit, result.error);
    return { ok: false, error: result.error };
  }
  if (result.data.status === "failed" || result.data.status === "canceled") {
    await markRefundFailed(admin, deposit, `Stripe odrzucił zwrot ${result.data.refundId}`);
    return { ok: false, error: "Stripe odrzucił zwrot" };
  }

  // Only while the target is still the one just sent (and the lease still
  // this call's): a claim that raised it meanwhile left a gap this refund
  // did not cover, and the next pass sends it.
  const done = result.data.status === "succeeded" && summary.data.inFlightPln === 0;
  const { data: written } = await admin
    .from("booking_deposits")
    .update({
      stripe_refund_id: result.data.refundId,
      refund_status: done ? "succeeded" : "pending",
      refund_failure_reason: null,
      refund_lock_until: null,
      ...(done ? { refunded_at: nowIso() } : {}),
    })
    .eq("booking_id", bookingId)
    .eq("refund_amount", deposit.refund_amount)
    .eq("refund_lock_until", held.lease)
    .select("booking_id")
    .maybeSingle();
  return written ? { ok: true } : "target_moved";
}

async function markRefundFailed(
  admin: Admin,
  deposit: BookingDeposit,
  reason: string,
  alert = true
): Promise<void> {
  const { data: flipped } = await admin
    .from("booking_deposits")
    .update({ refund_status: "failed", refund_failure_reason: reason })
    .eq("booking_id", deposit.booking_id)
    .or("refund_status.is.null,refund_status.neq.failed")
    .select("booking_id")
    .maybeSingle();
  if (flipped && alert) {
    await reportMoneyFailure(
      "deposit_refund_failed",
      `Zwrot kaucji do rezerwacji ${deposit.booking_id} nie powiódł się (${reason}). Do zwrotu łącznie: ${formatZl(Number(deposit.refund_amount))}. Ponowimy go automatycznie przy najbliższym przebiegu dziennym; możesz też ponowić go albo oznaczyć jako wykonany ręcznie w panelu kaucji.`
    );
  }
}

/**
 * Brings refund_status in line with what Stripe says happened — only while
 * the row's target is still the one the summary was compared with (and,
 * for a push, while it still holds its lease, which this write releases).
 * False when the target moved and nothing was written: whoever raised it
 * pushes the difference and records the status itself.
 */
async function applyRefundSummary(
  admin: Admin,
  deposit: BookingDeposit,
  summary: DepositRefundSummary,
  lease?: string
): Promise<boolean> {
  const target = Number(deposit.refund_amount);
  if (target <= 0) return true;
  const covered = summary.succeededPln + summary.inFlightPln;

  if (covered + 0.005 >= target) {
    const next = summary.inFlightPln > 0 ? "pending" : "succeeded";
    let query = admin
      .from("booking_deposits")
      .update({
        refund_status: next,
        refund_failure_reason: null,
        ...(next === "succeeded" && !deposit.refunded_at ? { refunded_at: nowIso() } : {}),
        ...(lease ? { refund_lock_until: null } : {}),
      })
      .eq("booking_id", deposit.booking_id)
      .eq("refund_amount", deposit.refund_amount);
    if (lease) query = query.eq("refund_lock_until", lease);
    const { data } = await query.select("booking_id").maybeSingle();
    return Boolean(data);
  }

  // Less went back than was decided. With a failed refund in the list, that
  // is a failure to retry. Without one, another part is being created at
  // this very moment (or a crash lost it — the daily job catches that).
  if (summary.lastFailure && summary.inFlightPln === 0) {
    await markRefundFailed(
      admin,
      deposit,
      `${summary.lastFailure.reason ?? "nieznany powód"} (zwrot ${summary.lastFailure.refundId})`
    );
  }
  return true;
}

/**
 * refund.updated / refund.failed / charge.refunded for a deposit payment.
 * Returns "not_deposit" when the payment is not a deposit, so the webhook
 * can treat it as a rental refund.
 */
export async function syncDepositRefunds(
  admin: Admin,
  paymentIntentId: string
): Promise<"ok" | "retry" | "not_deposit"> {
  const { data, error } = await admin
    .from("booking_deposits")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) return "retry";
  if (!data) return "not_deposit";
  const summary = await getDepositRefunds(paymentIntentId);
  if (!summary.ok) return "retry";
  await applyRefundSummary(admin, data as BookingDeposit, summary.data);
  return "ok";
}

async function completeBookingIfActive(admin: Admin, bookingId: string): Promise<void> {
  await admin
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", bookingId)
    .eq("status", "accepted");
}

/**
 * The whole deposit goes back: the owner confirmed the car is fine
 * ("vehicle_ok"), or stayed silent past the review deadline ("auto"). The
 * fee stays — it paid for exactly this handling. Either way the rental is
 * over, so an "accepted" booking becomes "completed".
 */
export async function refundFullDeposit(
  admin: Admin,
  bookingId: string,
  options: { decision: Extract<DepositDecision, "vehicle_ok" | "auto">; decidedBy: string | null }
): Promise<{ error: string | null }> {
  const { deposit, failed } = await loadDeposit(admin, bookingId);
  if (failed) return { error: "Nie udało się odczytać kaucji. Spróbuj ponownie za chwilę." };
  if (!deposit) return { error: "Ta rezerwacja nie ma wpłaconej kaucji." };

  const allowed: DepositState[] = options.decision === "auto" ? ["in_review"] : ["paid", "in_review"];
  if (!allowed.includes(deposit.status)) {
    return { error: "Kaucji nie można teraz zwrócić — odśwież stronę." };
  }
  if (options.decision === "auto" && deposit.review_deadline && new Date(deposit.review_deadline) > new Date()) {
    return { error: "Czas na sprawdzenie auta jeszcze trwa." };
  }

  const now = nowIso();
  const amount = Number(deposit.amount);
  const { data: claimed, error } = await admin
    .from("booking_deposits")
    .update({
      status: "settled",
      decision: options.decision,
      decided_at: now,
      decided_by: options.decidedBy,
      refund_amount: roundPln(Number(deposit.refund_amount) + amount),
      refund_status: "pending",
      refund_requested_at: now,
    })
    .eq("booking_id", bookingId)
    .eq("status", deposit.status)
    .eq("refund_amount", deposit.refund_amount)
    .select("booking_id")
    .maybeSingle();
  if (error || !claimed) {
    return { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };
  }

  await completeBookingIfActive(admin, bookingId);
  const refund = await pushDepositRefund(admin, bookingId);

  const { booking } = await loadBooking(admin, bookingId);
  if (booking) {
    await notifyUser({
      userId: booking.renter_id,
      type: "deposit_refunded",
      subject: `Zwracamy kaucję ${formatZl(amount)}`,
      body: refund.ok
        ? `Kaucja ${formatZl(amount)} za ${booking.carLabel} wraca do Ciebie. ${refundTimingSentence(deposit.payment_method_type)}`
        : `Zwrot kaucji ${formatZl(amount)} za ${booking.carLabel} jest zlecony, ale się opóźnia — dokończymy go i potwierdzimy, nie musisz nic robić.`,
      emailHtml: `
        <p>${
          options.decision === "vehicle_ok"
            ? "Właściciel potwierdził, że auto jest w porządku."
            : "Czas na sprawdzenie auta minął bez zgłoszenia szkody."
        }</p>
        <p>Kaucja <strong>${formatZl(amount)}</strong> za <strong>${escapeHtml(booking.carLabel)}</strong> wraca do Ciebie. ${
          refund.ok
            ? refundTimingSentence(deposit.payment_method_type)
            : "Zwrot się opóźnia — dokończymy go i potwierdzimy, nie musisz nic robić."
        }</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
      `,
      link: "/dashboard/rentals",
    });
  }
  return { error: null };
}

// ─────────────────────────────────────────────────────────────
// After the rental: the owner's review window
// ─────────────────────────────────────────────────────────────

/**
 * Opens the owner's window to check the car. Started by the owner clicking
 * "Zakończ" (DEPOSIT_REVIEW_DAYS from that moment) or, if they never do, by
 * the daily job once end_date has passed (DEPOSIT_REVIEW_DAYS from the end of
 * that day). A deposit that was asked for but never paid is closed instead:
 * the rental it was meant to secure is over.
 */
export async function startDepositReview(
  admin: Admin,
  bookingId: string,
  trigger: "owner" | "end_date",
  attempt = 0
): Promise<void> {
  const { deposit } = await loadDeposit(admin, bookingId);
  if (!deposit) return;

  if (deposit.status === "requested") {
    const closed = await closeDepositSession(admin, deposit);
    // "paid": recorded just now, and handleDepositPayment — seeing a rental
    // that is over (completed, or past its last day) — opened the review
    // itself. "blocked": Stripe can't say; leave it — a late payment on a
    // finished booking is still recorded and reviewed, and the daily job
    // tries again.
    if (closed !== "clear") return;
    // Missed: the renter opened a new payment page in the meantime (or the
    // row moved on). Once more with the row as it is now, which closes that
    // page first; the daily job covers anything after that.
    const voided = await voidRequestedDeposit(admin, bookingId, deposit.stripe_checkout_session_id);
    if (!voided && attempt === 0) await startDepositReview(admin, bookingId, trigger, 1);
    return;
  }
  if (deposit.status !== "paid") return;

  const { booking } = await loadBooking(admin, bookingId);
  if (!booking) return;

  const deadline =
    trigger === "end_date"
      ? startOfDayInPoland(addDaysIso(booking.end_date, 1 + DEPOSIT_REVIEW_DAYS))
      : new Date(Date.now() + DEPOSIT_REVIEW_DAYS * DAY_MS);

  const { data: claimed } = await admin
    .from("booking_deposits")
    .update({
      status: "in_review",
      review_started_at: nowIso(),
      review_deadline: deadline.toISOString(),
    })
    .eq("booking_id", bookingId)
    .eq("status", "paid")
    .select("booking_id")
    .maybeSingle();
  if (!claimed) return;

  const amount = Number(deposit.amount);
  const when = deadlineText(deadline);
  const labelHtml = escapeHtml(booking.carLabel);

  await notifyUser({
    userId: booking.owner_id,
    type: "deposit_review",
    subject: `Sprawdź auto i rozlicz kaucję do ${formatDatePl(deadline)}`,
    body: `Wynajem ${booking.carLabel} się zakończył. Sprawdź auto do ${when}: jeśli wszystko jest w porządku, kliknij „Auto w porządku — zwróć kaucję”, a przy szkodzie zatrzymaj część kaucji i opisz powód. Po tym terminie kaucja ${formatZl(amount)} wróci do najemcy automatycznie.`,
    emailHtml: `
      <p>Wynajem <strong>${labelHtml}</strong> (${booking.start_date} – ${booking.end_date}) się zakończył.</p>
      <p><strong>Sprawdź auto do ${when}.</strong></p>
      <ul>
        <li>Wszystko w porządku — kliknij „Auto w porządku — zwróć kaucję”, a kaucja od razu wróci do najemcy.</li>
        <li>Jest szkoda — kliknij „Zatrzymaj kaucję (szkoda)”, podaj kwotę i powód, a zdjęcia dodaj w sekcji zdjęć zwrotu.</li>
      </ul>
      <p>Jeśli nic nie zrobisz, po tym terminie kaucja ${formatZl(amount)} wróci do najemcy automatycznie.</p>
      <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
    `,
    link: "/dashboard/bookings",
  });

  // The deadline is when the refund is ORDERED (by the next daily run after
  // it); a card refund still takes days to arrive, so no date is promised
  // for the money itself.
  await notifyUser({
    userId: booking.renter_id,
    type: "deposit_review",
    subject: `Wynajem zakończony — właściciel sprawdza auto do ${formatDatePl(deadline)}`,
    body: `Wynajem ${booking.carLabel} się zakończył. Właściciel ma czas do ${when} na sprawdzenie auta — potem automatycznie zlecimy zwrot kaucji ${formatZl(amount)}. ${refundTimingSentence(deposit.payment_method_type)}`,
    emailHtml: `
      <p>Wynajem <strong>${labelHtml}</strong> się zakończył.</p>
      <p>Właściciel ma czas do <strong>${when}</strong> na sprawdzenie auta. Jeśli potwierdzi, że jest w porządku, zwrot kaucji ${formatZl(amount)} zlecimy od razu; jeśli nic nie zgłosi — automatycznie po tym terminie.</p>
      <p>${refundTimingSentence(deposit.payment_method_type)}</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
    `,
    link: "/dashboard/rentals",
  });
}

/**
 * A trip extension whose payment just landed. Its checkout page lives about
 * a day, so it can be paid after the daily job saw end_date pass and opened
 * the owner's review window, while the booking itself is still "accepted".
 * If nobody has decided anything yet, the window closes again — the renter
 * still has the car, and the daily job reopens it after the new end date.
 * Once the deposit has been settled or kept (the owner confirmed the car,
 * kept part of it, or it already went back), extending would leave days
 * with nothing securing them: "blocked", and the caller refunds the
 * extension instead.
 */
export async function reopenDepositForExtension(
  admin: Admin,
  bookingId: string,
  attempt = 0
): Promise<"ok" | "blocked" | "retry"> {
  const { deposit, failed } = await loadDeposit(admin, bookingId);
  if (failed) return "retry";
  if (!deposit) return "ok";
  if (deposit.status === "requested" || deposit.status === "processing" || deposit.status === "paid") {
    return "ok";
  }
  if (deposit.status !== "in_review") return "blocked";

  const { data: reopened, error } = await admin
    .from("booking_deposits")
    .update({ status: "paid", review_started_at: null, review_deadline: null })
    .eq("booking_id", bookingId)
    .eq("status", "in_review")
    .select("booking_id")
    .maybeSingle();
  if (error) return "retry";
  if (reopened) return "ok";
  // Lost a race with the owner's decision (or the automatic refund): look
  // once more and judge the new state.
  return attempt === 0 ? reopenDepositForExtension(admin, bookingId, 1) : "blocked";
}

// ─────────────────────────────────────────────────────────────
// Keeping part of it
// ─────────────────────────────────────────────────────────────

/**
 * The owner keeps `amountPln` of the deposit for damage. Rafał's rule: the
 * undisputed rest goes back to the renter at once; the kept part stays with
 * GoMambo for DEPOSIT_OBJECTION_DAYS, during which the renter may object.
 * No objection — the daily job passes it to the owner. An objection — an
 * admin decides. The renter hears about it here, before any money moves.
 */
export async function retainDeposit(
  admin: Admin,
  bookingId: string,
  claim: { amountPln: number; reason: string; ownerId: string }
): Promise<{ error: string | null }> {
  const { deposit, failed } = await loadDeposit(admin, bookingId);
  if (failed) return { error: "Nie udało się odczytać kaucji. Spróbuj ponownie za chwilę." };
  if (!deposit) return { error: "Ta rezerwacja nie ma wpłaconej kaucji." };
  const { booking } = await loadBooking(admin, bookingId);
  if (!booking) return { error: "Nie znaleziono rezerwacji." };

  const amount = Number(deposit.amount);
  const kept = roundPln(claim.amountPln);
  if (!(kept > 0) || kept > amount) {
    return { error: `Podaj kwotę większą od zera i nie większą niż kaucja (${formatZl(amount)}).` };
  }

  // Before pickup there is no car in anyone's hands to have damaged — also
  // when an owner ended a no-show early and the review window is open.
  if (todayInPoland() < booking.start_date) {
    return { error: "Kaucję można zatrzymać dopiero od dnia odbioru auta." };
  }
  if (deposit.status === "paid") {
    // Mid-trip: allowed, the car is with the renter. After the last day the
    // deposit is still "paid" only until the daily job opens the review
    // window — so the claim gets exactly the window that job would give,
    // never more: a booking held out of that job (its status pushed around
    // through the API) must not keep the right to retain for ever.
    const windowEnd = startOfDayInPoland(addDaysIso(booking.end_date, 1 + DEPOSIT_REVIEW_DAYS));
    if (booking.end_date < todayInPoland() && windowEnd <= new Date()) {
      return { error: "Czas na sprawdzenie auta minął — kaucja wraca do najemcy." };
    }
  } else if (deposit.status === "in_review") {
    if (deposit.review_deadline && new Date(deposit.review_deadline) <= new Date()) {
      return { error: "Czas na sprawdzenie auta minął — kaucja wraca do najemcy." };
    }
  } else {
    return { error: "Tej kaucji nie można już zatrzymać — odśwież stronę." };
  }

  const now = new Date();
  const rest = roundPln(amount - kept);
  const objectionDeadline = new Date(now.getTime() + DEPOSIT_OBJECTION_DAYS * DAY_MS);

  const { data: claimed, error } = await admin
    .from("booking_deposits")
    .update({
      status: "retention_pending",
      decision: "retained",
      decided_at: now.toISOString(),
      decided_by: claim.ownerId,
      retained_amount: kept,
      retention_reason: claim.reason,
      retained_at: now.toISOString(),
      objection_deadline: objectionDeadline.toISOString(),
      ...(rest > 0
        ? {
            refund_amount: roundPln(Number(deposit.refund_amount) + rest),
            refund_status: "pending" as const,
            refund_requested_at: now.toISOString(),
          }
        : {}),
    })
    .eq("booking_id", bookingId)
    .eq("status", deposit.status)
    .eq("refund_amount", deposit.refund_amount)
    .select("booking_id")
    .maybeSingle();
  if (error || !claimed) {
    return { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };
  }

  // On GoMambo's desk as a case, next to the trip photos both sides took.
  const description = `Zatrzymanie ${formatZl(kept)} z kaucji ${formatZl(amount)}. Powód podany przez właściciela: ${claim.reason}`;
  const { error: reportError } = await admin.from("damage_reports").insert({
    booking_id: bookingId,
    reporter_id: claim.ownerId,
    reporter_role: "owner",
    description,
  });
  if (reportError) {
    console.error("[deposit] damage report insert failed", { bookingId, message: reportError.message });
  }

  const refund = rest > 0 ? await pushDepositRefund(admin, bookingId) : ({ ok: true } as MoneyResult);

  // A claim made after the last day of the rental also ends it; one made
  // mid-trip leaves the trip running until the owner ends it.
  if (booking.end_date < todayInPoland()) {
    await completeBookingIfActive(admin, bookingId);
  }

  const when = deadlineText(objectionDeadline);
  const labelHtml = escapeHtml(booking.carLabel);
  const reasonHtml = escapeHtml(claim.reason).replace(/\n/g, "<br>");
  const restLine =
    rest > 0
      ? refund.ok
        ? `Pozostałe ${formatZl(rest)} zwracamy od razu. ${refundTimingSentence(deposit.payment_method_type)}`
        : `Pozostałe ${formatZl(rest)} zwracamy — zwrot się opóźnia, dokończymy go i potwierdzimy.`
      : "To cała kaucja — nic nie zostaje do zwrotu od razu.";

  await notifyUser({
    userId: booking.renter_id,
    type: "deposit_captured",
    subject:
      rest > 0
        ? `Kaucja częściowo zatrzymana: ${booking.carLabel}`
        : `Kaucja zatrzymana: ${booking.carLabel}`,
    body: `Właściciel zatrzymał ${formatZl(kept)} z kaucji za ${booking.carLabel}: ${claim.reason}. ${restLine} Nie zgadzasz się? Zgłoś sprzeciw w panelu do ${when} — wtedy decyzję podejmie GoMambo.`,
    emailHtml: `
      <p>Właściciel zatrzymał ${rest > 0 ? "część kaucji" : "całą kaucję"} za wynajem <strong>${labelHtml}</strong>.</p>
      <ul>
        <li><strong>Zatrzymana kwota:</strong> ${formatZl(kept)} z ${formatZl(amount)}</li>
        <li><strong>Powód:</strong> ${reasonHtml}</li>
      </ul>
      <p>${restLine}</p>
      <p><strong>Nie zgadzasz się?</strong> Kliknij „Nie zgadzam się” przy tej rezerwacji i napisz dlaczego — do <strong>${when}</strong>. Do tego czasu zatrzymana kwota zostaje u nas; po sprzeciwie decyzję podejmie GoMambo. Bez sprzeciwu przekażemy ją właścicielowi.</p>
      <p>Zdjęcia z odbioru i zwrotu znajdziesz w panelu rezerwacji.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  await notifyAdmins(admin, {
    queue: {
      type: "damage_reported",
      body: `Właściciel zatrzymał ${formatZl(kept)} z kaucji (${booking.carLabel}, rezerwacja ${bookingId}). Najemca ma czas na sprzeciw do ${when}.`,
    },
    link: "/admin/kaucje",
    email: {
      subject: `Zatrzymanie kaucji: ${booking.carLabel}`,
      intro: "Właściciel zatrzymał część kaucji. Nic nie trzeba robić, chyba że najemca zgłosi sprzeciw — wtedy przyjdzie osobne powiadomienie.",
      rows: [
        ["Auto", booking.carLabel],
        ["Rezerwacja", bookingId],
        ["Zatrzymano", `${formatZl(kept)} z ${formatZl(amount)}`],
        ["Powód", claim.reason],
        ["Termin sprzeciwu", when],
      ],
      cta: "Otwórz kaucje",
    },
  });

  return { error: null };
}

/** The renter's "Nie zgadzam się". Freezes the kept part for an admin. */
export async function objectToRetention(
  admin: Admin,
  bookingId: string,
  objection: { renterId: string; comment: string }
): Promise<{ error: string | null }> {
  const { data: claimed, error } = await admin
    .from("booking_deposits")
    .update({
      status: "retention_objected",
      objected_at: nowIso(),
      objection_comment: objection.comment,
    })
    .eq("booking_id", bookingId)
    .eq("status", "retention_pending")
    .gt("objection_deadline", nowIso())
    .select("retained_amount")
    .maybeSingle();
  if (error || !claimed) {
    return { error: "Termin na sprzeciw minął albo sprawa jest już rozstrzygnięta — odśwież stronę." };
  }

  const { booking } = await loadBooking(admin, bookingId);
  const kept = Number(claimed.retained_amount ?? 0);
  if (booking) {
    await notifyUser({
      userId: booking.owner_id,
      type: "deposit_objection",
      subject: `Najemca nie zgadza się z zatrzymaniem kaucji: ${booking.carLabel}`,
      body: `Najemca zgłosił sprzeciw wobec zatrzymania ${formatZl(kept)} z kaucji za ${booking.carLabel}. Ta kwota zostaje u nas, dopóki GoMambo nie rozstrzygnie sprawy — odezwiemy się.`,
      emailHtml: `
        <p>Najemca nie zgadza się z zatrzymaniem <strong>${formatZl(kept)}</strong> z kaucji za <strong>${escapeHtml(booking.carLabel)}</strong>.</p>
        <p><strong>Uzasadnienie najemcy:</strong></p>
        <p>${escapeHtml(objection.comment).replace(/\n/g, "<br>")}</p>
        <p>Zatrzymana kwota zostaje u nas, dopóki GoMambo nie rozstrzygnie sprawy. Jeśli masz zdjęcia szkody, dodaj je w sekcji zdjęć zwrotu — odezwiemy się.</p>
        <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
      `,
      link: "/dashboard/bookings",
    });
  }

  await notifyAdmins(admin, {
    queue: {
      type: "deposit_objection",
      body: `Najemca nie zgadza się z zatrzymaniem ${formatZl(kept)} z kaucji (${booking?.carLabel ?? "auto"}, rezerwacja ${bookingId}). Rozstrzygnij w panelu kaucji.`,
    },
    link: "/admin/kaucje",
    email: {
      subject: `Sprzeciw wobec zatrzymania kaucji: ${booking?.carLabel ?? bookingId}`,
      intro: "Najemca zgłosił sprzeciw. Zatrzymana kwota czeka na Twoją decyzję: przelew do właściciela, zwrot najemcy albo podział.",
      rows: [
        ["Auto", booking?.carLabel ?? null],
        ["Rezerwacja", bookingId],
        ["Zatrzymano", formatZl(kept)],
        ["Uzasadnienie najemcy", objection.comment],
      ],
      cta: "Rozstrzygnij",
    },
  });

  return { error: null };
}

/**
 * An admin's decision on a kept amount: `ownerAmountPln` goes to the owner,
 * the rest of the kept part back to the renter. Also how a failed transfer is
 * redirected (e.g. the owner never set up payouts) — then only the amount
 * that transfer was carrying is decided again (decidableRetention).
 */
export async function resolveRetention(
  admin: Admin,
  bookingId: string,
  decision: { ownerAmountPln: number; adminId: string }
): Promise<{ error: string | null }> {
  const { deposit, failed } = await loadDeposit(admin, bookingId);
  if (failed || !deposit) return { error: "Nie udało się odczytać kaucji." };
  const resolvable: DepositState[] = ["retention_pending", "retention_objected", "transfer_failed"];
  if (!resolvable.includes(deposit.status) || deposit.retained_amount === null) {
    return { error: "Tej kaucji nie można już rozstrzygnąć — odśwież stronę." };
  }

  const redirecting = deposit.status === "transfer_failed";
  const kept = decidableRetention(deposit);
  if (kept === null) {
    return { error: "Nie ma tu kwoty do rozstrzygnięcia — odśwież stronę." };
  }
  const toOwner = roundPln(decision.ownerAmountPln);
  if (!(toOwner >= 0) || toOwner > kept) {
    return { error: `Kwota dla właściciela musi mieścić się w 0–${formatZl(kept)}.` };
  }
  // What has gone (or is going) back plus what is decided here can never be
  // more than the deposit itself: the fee is not part of a retention.
  if (roundPln(Number(deposit.refund_amount) + kept) > Number(deposit.amount) + 0.005) {
    return {
      error: `Kwoty tej kaucji się nie zgadzają (do zwrotu już ${formatZl(Number(deposit.refund_amount))}, do rozstrzygnięcia ${formatZl(kept)}, kaucja ${formatZl(Number(deposit.amount))}). Sprawdź ją w Stripe i rozlicz ręcznie.`,
    };
  }

  // A transfer reported as failed may still have gone through (the call
  // timed out after Stripe made it). Redirecting that money to the renter
  // would then pay it out twice, so Stripe is asked first.
  if (deposit.status === "transfer_failed") {
    const existing = await findRetainedDepositTransfer(bookingId);
    if (!existing.ok) {
      return { error: `Nie udało się sprawdzić przelewów w Stripe (${existing.error}). Spróbuj za chwilę.` };
    }
    if (existing.data) {
      await admin
        .from("booking_deposits")
        .update({
          status: "settled",
          stripe_transfer_id: existing.data.transferId,
          transfer_amount: existing.data.amountPln,
          transferred_at: nowIso(),
          transfer_failure_reason: null,
        })
        .eq("booking_id", bookingId)
        .eq("status", "transfer_failed");
      return {
        error: `Przelew ${formatZl(existing.data.amountPln)} do właściciela jednak doszedł (${existing.data.transferId}) — zapisaliśmy go. Jeśli trzeba go odwrócić, użyj „Cofnij przelew i zwróć najemcy”.`,
      };
    }
  }
  const toRenter = roundPln(kept - toOwner);
  const now = nowIso();

  let claim = admin
    .from("booking_deposits")
    .update({
      status: toOwner > 0 ? "transferring" : "settled",
      transfer_amount: toOwner > 0 ? toOwner : null,
      transfer_claimed_at: toOwner > 0 ? now : null,
      transfer_failure_reason: null,
      decision: "admin",
      decided_at: now,
      decided_by: decision.adminId,
      ...(toRenter > 0
        ? {
            refund_amount: roundPln(Number(deposit.refund_amount) + toRenter),
            refund_status: "pending" as const,
            refund_requested_at: now,
          }
        : {}),
    })
    .eq("booking_id", bookingId)
    .eq("status", deposit.status)
    .eq("refund_amount", deposit.refund_amount);
  // Redirecting a failed transfer: only while it still carries the amount
  // decided on above, so nothing redirects a stale one.
  if (redirecting) claim = claim.eq("transfer_amount", kept);
  const { data: claimed, error } = await claim.select("booking_id").maybeSingle();
  if (error || !claimed) return { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };

  const { booking } = await loadBooking(admin, bookingId);
  // Both sides hear the decision before any money moves.
  if (booking) {
    const summary =
      toOwner === 0
        ? redirecting
          ? `GoMambo rozstrzygnęło sprawę zatrzymanej kaucji: kwota ${formatZl(kept)}, która miała trafić do właściciela, wraca do najemcy.`
          : `GoMambo rozstrzygnęło sprawę zatrzymanej kaucji: całe ${formatZl(kept)} wraca do najemcy.`
        : toRenter === 0
          ? `GoMambo rozstrzygnęło sprawę zatrzymanej kaucji: ${formatZl(toOwner)} przekazujemy właścicielowi.`
          : `GoMambo rozstrzygnęło sprawę zatrzymanej kaucji: ${formatZl(toOwner)} przekazujemy właścicielowi, a ${formatZl(toRenter)} wraca do najemcy.`;
    for (const [userId, path] of [
      [booking.renter_id, "/dashboard/rentals"],
      [booking.owner_id, "/dashboard/bookings"],
    ] as const) {
      await notifyUser({
        userId,
        type: "deposit_captured",
        subject: `Decyzja w sprawie kaucji: ${booking.carLabel}`,
        body: `${summary} (${booking.carLabel})`,
        emailHtml: `
          <p>${summary}</p>
          <p><strong>Auto:</strong> ${escapeHtml(booking.carLabel)}</p>
          ${toRenter > 0 && userId === booking.renter_id ? `<p>${refundTimingSentence(deposit.payment_method_type)}</p>` : ""}
          <p><a href="${SITE_URL}${path}">Zobacz rezerwację →</a></p>
        `,
        link: path,
      });
    }
  }

  const results: string[] = [];
  if (toRenter > 0) {
    const refund = await pushDepositRefund(admin, bookingId);
    if (!refund.ok) results.push(`zwrot najemcy: ${refund.error}`);
  }
  if (toOwner > 0) {
    const transfer = await pushRetentionTransfer(admin, bookingId);
    if (!transfer.ok) results.push(`przelew do właściciela: ${transfer.error}`);
  }
  return results.length > 0
    ? { error: `Decyzja zapisana, ale ${results.join("; ")}. Ponowimy automatycznie albo ponów ręcznie.` }
    : { error: null };
}

/**
 * Moves a claimed ("transferring") kept amount to the owner's Connect
 * account. Safe to call again: the attempt counter makes each try's key
 * unique, and transferRetainedDeposit first looks for a transfer this
 * booking already has.
 */
async function pushRetentionTransfer(admin: Admin, bookingId: string): Promise<MoneyResult> {
  const { deposit } = await loadDeposit(admin, bookingId);
  if (!deposit || deposit.status !== "transferring") return { ok: true };
  const amount = Number(deposit.transfer_amount ?? 0);
  if (!(amount > 0)) {
    await admin
      .from("booking_deposits")
      .update({ status: "settled" })
      .eq("booking_id", bookingId)
      .eq("status", "transferring");
    return { ok: true };
  }

  const { data: owner } = await admin
    .from("bookings")
    .select("owner:profiles!bookings_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded)")
    .eq("id", bookingId)
    .maybeSingle();
  const account =
    (owner as unknown as {
      owner: { stripe_connect_account_id: string | null; stripe_connect_onboarded: boolean } | null;
    } | null)?.owner ?? null;
  if (!account?.stripe_connect_account_id || !account.stripe_connect_onboarded) {
    return markTransferFailed(admin, deposit, "właściciel nie ma skonfigurowanych wypłat w Stripe");
  }

  let chargeId = deposit.stripe_charge_id;
  if (!chargeId && deposit.stripe_payment_intent_id) {
    const charge = await getDepositCharge(deposit.stripe_payment_intent_id);
    if (charge.ok && charge.data.chargeId) {
      chargeId = charge.data.chargeId;
      await admin
        .from("booking_deposits")
        .update({ stripe_charge_id: chargeId, payment_method_type: charge.data.paymentMethodType })
        .eq("booking_id", bookingId);
    }
  }
  if (!chargeId) {
    return markTransferFailed(admin, deposit, "nie udało się ustalić płatności kaucji w Stripe");
  }

  const { data: attempt } = await admin
    .from("booking_deposits")
    .update({ transfer_attempts: deposit.transfer_attempts + 1 })
    .eq("booking_id", bookingId)
    .eq("transfer_attempts", deposit.transfer_attempts)
    .eq("status", "transferring")
    .select("transfer_attempts")
    .maybeSingle();
  if (!attempt) return { ok: true };

  const result = await transferRetainedDeposit({
    bookingId,
    chargeId,
    destinationAccountId: account.stripe_connect_account_id,
    amountPln: amount,
    idempotencyKey: `deposit-transfer:${bookingId}:${attempt.transfer_attempts}`,
  });
  if (!result.ok) return markTransferFailed(admin, deposit, result.error);

  // The transfer is recorded whatever the row's status is by now — a bank
  // dispute can flip it to "disputed" while this call talks to Stripe — so
  // money that went out never goes missing from the row, and "Cofnij
  // przelew" stays possible. Only then does "transferring" become
  // "settled"; a disputed row stays disputed.
  const { data: recorded, error: recordError } = await admin
    .from("booking_deposits")
    .update({
      stripe_transfer_id: result.data.transferId,
      transferred_at: nowIso(),
      transfer_failure_reason: null,
    })
    .eq("booking_id", bookingId)
    .is("stripe_transfer_id", null)
    .select("booking_id")
    .maybeSingle();
  // Not written: the row stays "transferring", and the daily job's retry
  // (reconcileDeposits, step 3) finds this transfer in Stripe and records it.
  if (recordError) return { ok: true };
  await admin
    .from("booking_deposits")
    .update({ status: "settled" })
    .eq("booking_id", bookingId)
    .eq("status", "transferring");

  // Whoever recorded the transfer tells the owner, once — also when a retry
  // found a transfer an earlier, timed-out attempt had already made, and
  // also when the row has meanwhile become "disputed" (the money is theirs).
  if (recorded) {
    const { booking } = await loadBooking(admin, bookingId);
    if (booking) {
      await notifyUser({
        userId: booking.owner_id,
        type: "deposit_captured",
        subject: `Przelaliśmy zatrzymaną kaucję: ${booking.carLabel}`,
        body: `Przelaliśmy ${formatZl(amount)} z zatrzymanej kaucji za ${booking.carLabel} na Twoje konto wypłat.`,
        emailHtml: `
          <p>Przelaliśmy <strong>${formatZl(amount)}</strong> z zatrzymanej kaucji za <strong>${escapeHtml(booking.carLabel)}</strong> na Twoje konto wypłat w Stripe.</p>
          <p>Do Twojego banku trafią z najbliższą wypłatą Stripe.</p>
          <p><a href="${SITE_URL}/dashboard/bookings">Zobacz rezerwacje →</a></p>
        `,
        link: "/dashboard/bookings",
      });
    }
  }
  return { ok: true };
}

async function markTransferFailed(
  admin: Admin,
  deposit: BookingDeposit,
  reason: string
): Promise<MoneyResult> {
  const amountText = formatZl(Number(deposit.transfer_amount ?? 0));
  const { data: flipped } = await admin
    .from("booking_deposits")
    .update({ status: "transfer_failed", transfer_failure_reason: reason })
    .eq("booking_id", deposit.booking_id)
    .eq("status", "transferring")
    .select("booking_id")
    .maybeSingle();
  if (flipped) {
    await reportMoneyFailure(
      "deposit_transfer_failed",
      `Przelew ${amountText} z zatrzymanej kaucji do właściciela (rezerwacja ${deposit.booking_id}) nie powiódł się (${reason}). Pieniądze są na saldzie GoMambo. Ponowimy go automatycznie raz dziennie; możesz też skierować tę kwotę do najemcy w panelu kaucji.`
    );
    return { ok: false, error: reason };
  }
  // Not flipped: another call settled or failed it already (and said so),
  // or a bank dispute stopped it — then nothing retries it automatically.
  const { deposit: now } = await loadDeposit(admin, deposit.booking_id);
  if (now?.status === "disputed") {
    await reportMoneyFailure(
      "deposit_transfer_failed",
      `Przelew ${amountText} z zatrzymanej kaucji do właściciela (rezerwacja ${deposit.booking_id}) nie powiódł się (${reason}), a płatność kaucji jest objęta sporem w banku — nie ponowimy go automatycznie. Rozlicz kaucję w panelu kaucji po zamknięciu sporu.`
    );
  }
  return { ok: false, error: reason };
}

// ─────────────────────────────────────────────────────────────
// Cancellation
// ─────────────────────────────────────────────────────────────

// "voided": nothing had been paid, and the payment page is closed.
// "refunded" / "refund_failed": it had been paid and is on its way back (or
// stuck — an admin has been alerted). "pending_payment": a BLIK payment is
// still settling; if it lands, the webhook returns it (the fee by the same
// rule as here). "needs_admin": part of it is already in a retention or a
// bank dispute.
export type DepositSettlementOutcome =
  | "not_applicable"
  | "voided"
  | "refunded"
  | "refund_failed"
  | "pending_payment"
  | "needs_admin";

export type DepositSettlement = {
  outcome: DepositSettlementOutcome;
  /** The deposit itself going back (or to go back, once a pending payment lands). */
  amountPln: number;
  /** The handling fee going back with it. */
  feePln: number;
  /** The handling fee GoMambo keeps, because the renter cancelled. */
  feeKeptPln: number;
};

const nothingToSettle = (outcome: DepositSettlementOutcome): DepositSettlement => ({
  outcome,
  amountPln: 0,
  feePln: 0,
  feeKeptPln: 0,
});

function settlementOf(
  outcome: DepositSettlementOutcome,
  deposit: Pick<BookingDeposit, "amount" | "fee_amount">,
  feeBackPln: number
): DepositSettlement {
  const fee = Number(deposit.fee_amount);
  const feePln = roundPln(Math.min(Math.max(feeBackPln, 0), fee));
  return {
    outcome,
    amountPln: Number(deposit.amount),
    feePln,
    feeKeptPln: roundPln(fee - feePln),
  };
}

/** Passes settleDepositOnCancellation makes over a deposit that moves under it. */
const SETTLE_ATTEMPTS = 2;

/**
 * What happens to the deposit when its booking is cancelled. The fee comes
 * back only when the cancellation is not the renter's doing — the owner or
 * GoMambo called it off (Rafał's rule). Called AFTER the booking is marked
 * cancelled (and after the fee decision is recorded on the deposit), so a
 * payment landing in between is treated as a late payment and returned by
 * the same rule.
 */
export async function settleDepositOnCancellation(
  admin: Admin,
  bookingId: string,
  options: { includeFee: boolean },
  attempt = 0
): Promise<DepositSettlement> {
  const { deposit } = await loadDeposit(admin, bookingId);
  if (!deposit) return nothingToSettle("not_applicable");

  switch (deposit.status) {
    case "requested": {
      const closed = await closeDepositSession(admin, deposit);
      if (closed === "paid") {
        // The payment was recorded just now — but by whom decides what is
        // left to do. Recorded as a late payment (the booking was already
        // cancelled), it is on its way back. Recorded as "paid" (the
        // webhook claimed it a moment before the cancellation showed), it
        // still has to be returned — by the "paid" branch, with this
        // cancellation's fee rule. So: look again and settle what is there.
        return attempt < SETTLE_ATTEMPTS
          ? settleDepositOnCancellation(admin, bookingId, options, attempt + 1)
          : nothingToSettle("not_applicable");
      }
      // Even when Stripe can't confirm the page is closed ("blocked"), the
      // row is voided: a payment that still lands on a voided deposit is
      // returned by the webhook (the fee by depositFeeComesBack). Bound to
      // the page just closed: one the renter opened in between is closed
      // and voided on the next pass, never left payable behind this void.
      const voided = await voidRequestedDeposit(admin, bookingId, deposit.stripe_checkout_session_id);
      if (voided) return nothingToSettle("voided");
      // It moved meanwhile (a new payment page, a BLIK went to
      // "processing", a payment landed): settle whatever it is now instead
      // of claiming it was voided.
      if (attempt < SETTLE_ATTEMPTS) {
        return settleDepositOnCancellation(admin, bookingId, options, attempt + 1);
      }
      // Still moving after several passes: left to the daily job's safety
      // net (reconcileDeposits, step 5), which settles deposits of
      // cancelled bookings by the rule recorded above.
      console.error("[deposit] cancellation could not close a deposit that kept changing", { bookingId });
      return nothingToSettle("not_applicable");
    }
    case "processing": {
      // Stripe is asked once: a payment it already shows as settled (or
      // failed) is finished here by the same rules — returned as a late
      // payment, or voided — instead of waiting for its event. The row is
      // never voided while still "processing": a later success must find it.
      if (attempt < SETTLE_ATTEMPTS) {
        const state = await resolveProcessingDeposit(admin, deposit);
        if (state === "paid" || state === "failed") {
          return settleDepositOnCancellation(admin, bookingId, options, attempt + 1);
        }
      }
      return settlementOf(
        "pending_payment",
        deposit,
        options.includeFee ? Number(deposit.fee_amount) : 0
      );
    }
    case "paid":
    case "in_review": {
      const back = roundPln(Number(deposit.amount) + (options.includeFee ? Number(deposit.fee_amount) : 0));
      const now = nowIso();
      const { data: claimed } = await admin
        .from("booking_deposits")
        .update({
          status: "settled",
          decision: "cancelled",
          decided_at: now,
          refund_amount: roundPln(Number(deposit.refund_amount) + back),
          refund_status: "pending",
          refund_requested_at: now,
        })
        .eq("booking_id", bookingId)
        .eq("status", deposit.status)
        .eq("refund_amount", deposit.refund_amount)
        .select("booking_id")
        .maybeSingle();
      if (!claimed) {
        return attempt < SETTLE_ATTEMPTS
          ? settleDepositOnCancellation(admin, bookingId, options, attempt + 1)
          : nothingToSettle("not_applicable");
      }
      const refund = await pushDepositRefund(admin, bookingId);
      return settlementOf(
        refund.ok ? "refunded" : "refund_failed",
        deposit,
        options.includeFee ? Number(deposit.fee_amount) : 0
      );
    }
    case "settled": {
      // A payment that landed after the cancellation and was returned as a
      // late payment — by the webhook, or by closeDepositSession above. Say
      // what is coming back; the fee part is whatever went back beyond the
      // deposit.
      if (deposit.decision !== "late_payment") return nothingToSettle("not_applicable");
      return settlementOf(
        deposit.refund_status === "failed" ? "refund_failed" : "refunded",
        deposit,
        Number(deposit.refund_amount) - Number(deposit.amount)
      );
    }
    case "retention_pending":
    case "retention_objected":
    case "transferring":
    case "transfer_failed":
    case "disputed":
      return nothingToSettle("needs_admin");
    default:
      return nothingToSettle("not_applicable");
  }
}

/** The sentence the renter is told about their deposit on cancellation. */
export function renterDepositSentence(result: DepositSettlement): string {
  // The deposit and the fee named apart: the fee is not part of the deposit,
  // and when the renter cancelled it is the part that does not come back.
  const what =
    result.feePln > 0
      ? `kaucję ${formatZl(result.amountPln)} i opłatę za jej obsługę ${formatZl(result.feePln)}`
      : `kaucję ${formatZl(result.amountPln)}`;
  const feeKept =
    result.feeKeptPln > 0
      ? ` Opłata za obsługę kaucji (${formatZl(result.feeKeptPln)}) nie podlega zwrotowi przy anulowaniu przez najemcę.`
      : "";
  switch (result.outcome) {
    case "refunded":
      return ` Zwracamy ${what}.${feeKept}`;
    case "refund_failed":
      return " Zwrot kaucji się opóźnia — dokończymy go i potwierdzimy, nie musisz nic robić.";
    case "pending_payment":
      return ` Jeśli wpłata kaucji jeszcze dotrze, zwrócimy ${what}.${feeKept}`;
    case "needs_admin":
      return " Kaucją zajmie się GoMambo — odezwiemy się.";
    default:
      return "";
  }
}

// ─────────────────────────────────────────────────────────────
// Bank disputes
// ─────────────────────────────────────────────────────────────

/**
 * charge.dispute.created on a deposit. Every automatic move stops — a
 * refund would fail anyway while the dispute is open — and an admin is told.
 */
export async function markDepositDisputed(
  admin: Admin,
  dispute: { paymentIntentId: string; disputeId: string }
): Promise<"ok" | "retry" | "not_deposit"> {
  const { data: deposit, error } = await admin
    .from("booking_deposits")
    .select("booking_id, status, stripe_transfer_id")
    .eq("stripe_payment_intent_id", dispute.paymentIntentId)
    .maybeSingle();
  if (error) return "retry";
  if (!deposit) return "not_deposit";

  const { data: flipped, error: updateError } = await admin
    .from("booking_deposits")
    .update({ status: "disputed", stripe_dispute_id: dispute.disputeId, disputed_at: nowIso() })
    .eq("booking_id", deposit.booking_id)
    .neq("status", "disputed")
    .select("booking_id")
    .maybeSingle();
  if (updateError) return "retry";
  if (flipped) {
    // A transfer of the kept part may already have gone out to the owner —
    // made by a call that crashed before recording it. Looked up, so the
    // admin knows where the money is and "Cofnij przelew" stays possible.
    const transferNote =
      (deposit.status === "transferring" || deposit.status === "transfer_failed") &&
      !deposit.stripe_transfer_id
        ? await recordUnrecordedTransfer(admin, deposit.booking_id)
        : "";
    await reportMoneyFailure(
      "payment_disputed",
      `Najemca zgłosił w banku reklamację płatności kaucji do rezerwacji ${deposit.booking_id} (spór ${dispute.disputeId}; stan kaucji przed sporem: ${DEPOSIT_STATE_LABELS[deposit.status as DepositState] ?? deposit.status}). Automatyczne zwroty i przelewy tej kaucji są wstrzymane.${transferNote} Odpowiedz na spór w Stripe, a po jego zamknięciu rozlicz kaucję w panelu kaucji.`
    );
  }
  return "ok";
}

/**
 * Looks in Stripe for a transfer of the kept part that the row does not
 * show, and records it if there is one. Returns a sentence for the admin.
 */
async function recordUnrecordedTransfer(admin: Admin, bookingId: string): Promise<string> {
  const existing = await findRetainedDepositTransfer(bookingId);
  if (!existing.ok) {
    return " Nie udało się sprawdzić w Stripe, czy przelew zatrzymanej kwoty do właściciela już wyszedł — sprawdź to w Stripe.";
  }
  if (!existing.data) {
    return " Przelew zatrzymanej kwoty do właściciela był w toku — jeśli jednak wyjdzie, zapiszemy go przy kaucji.";
  }
  await admin
    .from("booking_deposits")
    .update({
      stripe_transfer_id: existing.data.transferId,
      transfer_amount: existing.data.amountPln,
      transferred_at: nowIso(),
      transfer_failure_reason: null,
    })
    .eq("booking_id", bookingId)
    .is("stripe_transfer_id", null);
  return ` Przelew ${formatZl(existing.data.amountPln)} zatrzymanej kwoty do właściciela już jednak wyszedł (${existing.data.transferId}) — zapisaliśmy go przy kaucji.`;
}

// ─────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────

/** "Ponów" for a refund that failed. */
export async function retryDepositRefund(admin: Admin, bookingId: string): Promise<{ error: string | null }> {
  const { data: claimed } = await admin
    .from("booking_deposits")
    .update({ refund_status: "pending", refund_failure_reason: null, refund_requested_at: nowIso() })
    .eq("booking_id", bookingId)
    .eq("refund_status", "failed")
    .neq("status", "disputed")
    .select("booking_id")
    .maybeSingle();
  if (!claimed) return { error: "Ten zwrot nie czeka na ponowienie — odśwież stronę." };
  const result = await pushDepositRefund(admin, bookingId);
  return result.ok ? { error: null } : { error: `Zwrot znów się nie powiódł: ${result.error}` };
}

/**
 * "Zwróć opłatę za obsługę": the fee of a cancelled booking's deposit, for
 * when it was kept although the cancellation was not the renter's doing —
 * the daily job has to assume the renter when nothing recorded who cancelled
 * (reconcileDeposits, step 5). Once only: the claim raises refund_amount by
 * exactly the fee, and only while what was paid still covers it.
 */
export async function refundDepositFee(
  admin: Admin,
  bookingId: string,
  adminId: string
): Promise<{ error: string | null }> {
  const { deposit, failed } = await loadDeposit(admin, bookingId);
  if (failed || !deposit) return { error: "Nie udało się odczytać kaucji." };
  const fee = Number(deposit.fee_amount);
  const unreturned = roundPln(Number(deposit.paid_amount ?? 0) - Number(deposit.refund_amount));
  const eligible =
    deposit.status === "settled" &&
    (deposit.decision === "cancelled" || deposit.decision === "late_payment") &&
    fee > 0 &&
    unreturned + 0.005 >= fee &&
    deposit.refund_status !== "failed";
  if (!eligible) {
    return { error: "Opłaty za obsługę tej kaucji nie da się zwrócić — odśwież stronę." };
  }

  const now = nowIso();
  const { data: claimed } = await admin
    .from("booking_deposits")
    .update({
      cancel_fee_refund: true,
      decided_at: now,
      decided_by: adminId,
      refund_amount: roundPln(Number(deposit.refund_amount) + fee),
      refund_status: "pending",
      refund_requested_at: now,
    })
    .eq("booking_id", bookingId)
    .eq("status", "settled")
    .eq("refund_amount", deposit.refund_amount)
    .select("booking_id")
    .maybeSingle();
  if (!claimed) return { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };

  const refund = await pushDepositRefund(admin, bookingId);
  const { booking } = await loadBooking(admin, bookingId);
  if (booking) {
    await notifyUser({
      userId: booking.renter_id,
      type: "deposit_refunded",
      subject: `Zwracamy opłatę za obsługę kaucji: ${booking.carLabel}`,
      body: `GoMambo zwraca Ci także opłatę za obsługę kaucji (${formatZl(fee)}) za anulowaną rezerwację ${booking.carLabel}. ${refundTimingSentence(deposit.payment_method_type)}`,
      emailHtml: `
        <p>Rezerwacja <strong>${escapeHtml(booking.carLabel)}</strong> nie została anulowana z Twojej winy, więc zwracamy Ci także opłatę za obsługę kaucji: <strong>${formatZl(fee)}</strong>.</p>
        <p>${refundTimingSentence(deposit.payment_method_type)}</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwacje →</a></p>
      `,
      link: "/dashboard/rentals",
    });
  }
  return refund.ok
    ? { error: null }
    : { error: `Zwrot opłaty zapisany, ale się nie powiódł (${refund.error}). Ponów go.` };
}

/** "Ponów" for a transfer to the owner that failed. */
export async function retryRetentionTransfer(
  admin: Admin,
  bookingId: string
): Promise<{ error: string | null }> {
  const { data: claimed } = await admin
    .from("booking_deposits")
    .update({ status: "transferring", transfer_claimed_at: nowIso(), transfer_failure_reason: null })
    .eq("booking_id", bookingId)
    .eq("status", "transfer_failed")
    .select("booking_id")
    .maybeSingle();
  if (!claimed) return { error: "Ten przelew nie czeka na ponowienie — odśwież stronę." };
  const result = await pushRetentionTransfer(admin, bookingId);
  return result.ok ? { error: null } : { error: `Przelew znów się nie powiódł: ${result.error}` };
}

/** Gives the owner (review) or the renter (objection) DEPOSIT_REVIEW_DAYS more. */
export async function extendDepositWindow(
  admin: Admin,
  bookingId: string
): Promise<{ error: string | null }> {
  const { deposit } = await loadDeposit(admin, bookingId);
  if (!deposit) return { error: "Nie znaleziono kaucji." };
  const column =
    deposit.status === "in_review"
      ? "review_deadline"
      : deposit.status === "retention_pending"
        ? "objection_deadline"
        : null;
  const current = column ? deposit[column] : null;
  if (!column || !current) return { error: "Tej kaucji nie ma czego przedłużać." };
  const base = Math.max(new Date(current).getTime(), Date.now());
  const next = new Date(base + DEPOSIT_REVIEW_DAYS * DAY_MS).toISOString();
  const { data: claimed } = await admin
    .from("booking_deposits")
    .update(column === "review_deadline" ? { review_deadline: next } : { objection_deadline: next })
    .eq("booking_id", bookingId)
    .eq("status", deposit.status)
    .eq(column, current)
    .select("booking_id")
    .maybeSingle();
  return claimed ? { error: null } : { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };
}

/**
 * Closes a case that was settled outside the app — a refund sent by bank
 * transfer, a dispute the bank decided, an owner paid by hand. Records it so
 * nothing automatic touches the deposit again; it moves no money itself.
 */
export async function markDepositSettledManually(
  admin: Admin,
  bookingId: string,
  adminId: string
): Promise<{ error: string | null }> {
  const { deposit } = await loadDeposit(admin, bookingId);
  if (!deposit) return { error: "Nie znaleziono kaucji." };
  const closable =
    deposit.status === "disputed" ||
    deposit.status === "transfer_failed" ||
    (deposit.status === "settled" && deposit.refund_status === "failed");
  if (!closable) return { error: "Tę kaucję rozlicza się zwykłą ścieżką — odśwież stronę." };

  // A transfer to the owner that the row does not show may still have gone
  // out (a call that timed out, or one a dispute overtook). Asked first, so
  // it is recorded — "Cofnij przelew" needs it — and so a "failed" transfer
  // that in fact arrived is not paid to the owner a second time by hand.
  let foundTransfer: { transferId: string; amountPln: number } | null = null;
  if (
    (deposit.status === "disputed" || deposit.status === "transfer_failed") &&
    !deposit.stripe_transfer_id &&
    Number(deposit.transfer_amount ?? 0) > 0
  ) {
    const existing = await findRetainedDepositTransfer(bookingId);
    if (!existing.ok) {
      return { error: `Nie udało się sprawdzić przelewów w Stripe (${existing.error}). Spróbuj za chwilę.` };
    }
    foundTransfer = existing.data;
    if (foundTransfer && deposit.status === "transfer_failed") {
      await admin
        .from("booking_deposits")
        .update({
          status: "settled",
          stripe_transfer_id: foundTransfer.transferId,
          transfer_amount: foundTransfer.amountPln,
          transferred_at: nowIso(),
          transfer_failure_reason: null,
        })
        .eq("booking_id", bookingId)
        .eq("status", "transfer_failed");
      return {
        error: `Przelew ${formatZl(foundTransfer.amountPln)} do właściciela jednak doszedł (${foundTransfer.transferId}) — zapisaliśmy go i kaucja jest rozliczona. Nie przelewaj tej kwoty ręcznie; jeśli trzeba ją odwrócić, użyj „Cofnij przelew i zwróć najemcy”.`,
      };
    }
  }

  const now = nowIso();
  const { data: claimed } = await admin
    .from("booking_deposits")
    .update({
      status: "settled",
      decision: "admin",
      decided_at: now,
      decided_by: adminId,
      ...(foundTransfer
        ? {
            stripe_transfer_id: foundTransfer.transferId,
            transfer_amount: foundTransfer.amountPln,
            transferred_at: now,
          }
        : {}),
      ...(deposit.refund_status === "failed"
        ? {
            refund_status: "succeeded" as const,
            refunded_at: now,
            refund_failure_reason: "rozliczone ręcznie przez administratora",
          }
        : {}),
      ...(deposit.status === "transfer_failed"
        ? { transfer_failure_reason: "rozliczone ręcznie przez administratora" }
        : {}),
    })
    .eq("booking_id", bookingId)
    .eq("status", deposit.status)
    .select("booking_id")
    .maybeSingle();
  return claimed ? { error: null } : { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };
}

/**
 * Takes a transferred kept amount back from the owner and returns it to the
 * renter — e.g. after a chargeback the owner has to answer for. Works only
 * while the owner still has the money on their Stripe balance.
 */
export async function reverseTransferToRenter(
  admin: Admin,
  bookingId: string,
  adminId: string
): Promise<{ error: string | null }> {
  const now = nowIso();
  const { data: claimed } = await admin
    .from("booking_deposits")
    .update({ transfer_reversed_at: now })
    .eq("booking_id", bookingId)
    .eq("status", "settled")
    .is("transfer_reversed_at", null)
    .not("stripe_transfer_id", "is", null)
    .select("*")
    .maybeSingle();
  if (!claimed) return { error: "Nie ma przelewu do cofnięcia — odśwież stronę." };
  const deposit = claimed as BookingDeposit;

  const reversal = await reverseDepositTransfer({
    transferId: deposit.stripe_transfer_id!,
    bookingId,
    idempotencyKey: `deposit-reversal:${bookingId}`,
  });
  if (!reversal.ok) {
    await admin
      .from("booking_deposits")
      .update({ transfer_reversed_at: null })
      .eq("booking_id", bookingId);
    return {
      error: `Stripe nie cofnął przelewu (${reversal.error}) — właściciel mógł już wypłacić te środki. Rozlicz to ręcznie.`,
    };
  }

  const amount = Number(deposit.transfer_amount ?? 0);
  const reversalId = reversal.data.reversalId;
  // The reversed amount is added to the refund target as it stands — like
  // every other raise, conditional on it, so a refund claim landing in
  // between is never overwritten. The reversal id goes in the same write:
  // it is this call's mark that the raise landed. A write that committed but
  // whose reply was lost shows that mark on the reload, and is not added a
  // second time.
  let base: BookingDeposit = deposit;
  let raised = false;
  for (let tryNo = 0; tryNo < 3; tryNo += 1) {
    const { data } = await admin
      .from("booking_deposits")
      .update({
        stripe_transfer_reversal_id: reversalId,
        decision: "admin",
        decided_at: now,
        decided_by: adminId,
        refund_amount: roundPln(Number(base.refund_amount) + amount),
        refund_status: "pending",
        refund_requested_at: now,
      })
      .eq("booking_id", bookingId)
      .eq("transfer_reversed_at", now)
      .is("stripe_transfer_reversal_id", null)
      .eq("refund_amount", base.refund_amount)
      .select("booking_id")
      .maybeSingle();
    if (data) {
      raised = true;
      break;
    }
    const { deposit: reloaded } = await loadDeposit(admin, bookingId);
    if (!reloaded) break;
    if (reloaded.stripe_transfer_reversal_id === reversalId) {
      raised = true;
      break;
    }
    // Retried only while the row is still this call's claim, not yet raised.
    const stillClaimed =
      reloaded.stripe_transfer_reversal_id === null &&
      reloaded.transfer_reversed_at !== null &&
      Date.parse(reloaded.transfer_reversed_at) === Date.parse(now);
    if (!stillClaimed) break;
    base = reloaded;
  }
  if (!raised) {
    // Best effort: the reversal itself is done in Stripe and must stay on
    // record even though the raise is not.
    await admin
      .from("booking_deposits")
      .update({ stripe_transfer_reversal_id: reversalId })
      .eq("booking_id", bookingId)
      .is("stripe_transfer_reversal_id", null);
    await reportMoneyFailure(
      "deposit_refund_failed",
      `Przelew ${formatZl(amount)} zatrzymanej kaucji do rezerwacji ${bookingId} został cofnięty od właściciela (${reversalId}), ale nie udało się zapisać zwrotu tej kwoty najemcy. Zwróć ją najemcy ręcznie w Stripe.`
    );
    return {
      error: "Przelew cofnięty, ale nie udało się zapisać zwrotu najemcy — zwróć tę kwotę ręcznie w Stripe.",
    };
  }

  const { booking } = await loadBooking(admin, bookingId);
  if (booking) {
    await notifyUser({
      userId: booking.owner_id,
      type: "deposit_captured",
      subject: `Cofnęliśmy przelew zatrzymanej kaucji: ${booking.carLabel}`,
      body: `GoMambo cofnęło przelew ${formatZl(amount)} z zatrzymanej kaucji za ${booking.carLabel}; kwota wraca do najemcy.`,
      emailHtml: `
        <p>GoMambo cofnęło przelew <strong>${formatZl(amount)}</strong> z zatrzymanej kaucji za <strong>${escapeHtml(booking.carLabel)}</strong>. Kwota wraca do najemcy.</p>
        <p>Pytania: kontakt@gomambo.pl.</p>
      `,
      link: "/dashboard/bookings",
    });
    await notifyUser({
      userId: booking.renter_id,
      type: "deposit_refunded",
      subject: `Zwracamy zatrzymaną kaucję: ${booking.carLabel}`,
      body: `GoMambo zwraca Ci ${formatZl(amount)} z zatrzymanej wcześniej kaucji za ${booking.carLabel}.`,
      emailHtml: `
        <p>Zwracamy Ci <strong>${formatZl(amount)}</strong> z zatrzymanej wcześniej kaucji za <strong>${escapeHtml(booking.carLabel)}</strong>.</p>
        <p>${refundTimingSentence(deposit.payment_method_type)}</p>
      `,
      link: "/dashboard/rentals",
    });
  }

  const refund = await pushDepositRefund(admin, bookingId);
  return refund.ok
    ? { error: null }
    : { error: `Przelew cofnięty, ale zwrot najemcy się nie powiódł (${refund.error}). Ponów go.` };
}

// ─────────────────────────────────────────────────────────────
// The daily job
// ─────────────────────────────────────────────────────────────

/**
 * Opens deposits for trips inside the lead window that have none yet, the
 * soonest pickups first. Bookings that already have a deposit are left out
 * by the query itself (an anti-join on the one-to-one embed), not after a
 * limit: a running trip matches the date filter until its last day, and
 * enough of those taken before the filter would crowd a new booking out of
 * every run — no deposit row means no pickup details and no owner alarm.
 * Legacy bookings on cars with no deposit are pinned at 0 on their first
 * pass (requestDepositIfDue), so they stop coming back.
 */
export async function runDepositRequests(admin: Admin): Promise<number> {
  const today = todayInPoland();
  const { data: due, error } = await admin
    .from("bookings")
    .select("id, booking_deposits(booking_id)")
    .eq("status", "accepted")
    .eq("payment_status", "paid")
    .lte("start_date", addDaysIso(today, DEPOSIT_REQUEST_LEAD_DAYS))
    .gte("end_date", today)
    .or("deposit_amount.gt.0,deposit_amount.is.null")
    .is("booking_deposits", null)
    .order("start_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(CRON_BATCH + 1);
  if (error) {
    console.error("[deposit] reading bookings due a deposit failed", { message: error.message });
    return 0;
  }
  const ids = (due ?? []).map((row) => row.id);
  if (ids.length > CRON_BATCH) {
    // The rest are asked on the next run — latest pickups last.
    console.warn("[deposit] more bookings due a deposit than one run asks for", { batch: CRON_BATCH });
  }

  let requested = 0;
  for (const id of ids.slice(0, CRON_BATCH)) {
    if (await requestDepositIfDue(admin, id)) requested += 1;
  }
  return requested;
}

type DueDepositRow = {
  booking_id: string;
  amount: number;
  fee_amount: number;
  due_at?: string | null;
  bookings: {
    start_date: string;
    end_date: string;
    renter_id: string;
    owner_id: string;
    cars: { brand: string; model: string; year: number } | null;
  } | null;
};

const rowLabel = (row: DueDepositRow) =>
  row.bookings?.cars
    ? `${row.bookings.cars.brand} ${row.bookings.cars.model} (${row.bookings.cars.year})`
    : "auto";

/** T-1: pickup is tomorrow and the deposit is still not paid. */
export async function runDepositReminders(admin: Admin): Promise<number> {
  const today = todayInPoland();
  const { data: rows } = await admin
    .from("booking_deposits")
    .select(
      "booking_id, amount, fee_amount, bookings!inner(start_date, end_date, renter_id, owner_id, status, cars(brand, model, year))"
    )
    .eq("status", "requested")
    .is("reminded_at", null)
    // Not a request opened earlier today: that mail is still fresh.
    .lt("requested_at", startOfDayInPoland(today).toISOString())
    .eq("bookings.start_date", addDaysIso(today, 1))
    .eq("bookings.status", "accepted")
    .limit(CRON_BATCH);

  let reminded = 0;
  for (const row of (rows ?? []) as unknown as DueDepositRow[]) {
    const { data: claimed } = await admin
      .from("booking_deposits")
      .update({ reminded_at: nowIso() })
      .eq("booking_id", row.booking_id)
      .is("reminded_at", null)
      .eq("status", "requested")
      .select("booking_id")
      .maybeSingle();
    if (!claimed || !row.bookings) continue;
    const label = rowLabel(row);
    const total = Number(row.amount) + Number(row.fee_amount);
    await notifyUser({
      userId: row.bookings.renter_id,
      type: "deposit_requested",
      subject: `PILNE: wpłać kaucję — odbiór jutro (${label})`,
      body: `Odbiór ${label} jest jutro, a kaucja (${formatZl(total)}) wciąż nie jest wpłacona. Bez niej nie wyślemy danych do odbioru, a właściciel nie wyda auta.`,
      emailHtml: `
        <p><strong>Odbiór ${escapeHtml(label)} jest jutro, a kaucja wciąż nie jest wpłacona.</strong></p>
        <p>Do wpłaty: <strong>${formatZl(total)}</strong> (kaucja zwrotna ${formatZl(Number(row.amount))} + opłata za obsługę kaucji ${formatZl(Number(row.fee_amount))}), kartą lub BLIK-iem.</p>
        <p>Bez niej nie wyślemy Ci danych do odbioru, a właściciel nie wyda auta.</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Wpłać kaucję teraz →</a></p>
      `,
      link: "/dashboard/rentals",
    });
    reminded += 1;
  }
  return reminded;
}

/**
 * Pickup day (or later) and still no deposit. Rafał's rule: no automatic
 * cancellation. The owner is told not to hand the car over and may cancel
 * for non-payment from the bookings page; the renter can still pay; an
 * admin is told.
 *
 * Only for deposits asked for before pickup day: one asked for on the day
 * itself warned the owner at once (requestDepositIfDue) and gets this alarm
 * the morning after, if the trip is still running. A trip already over is
 * left to runDepositReviewStart, which closes its unpaid deposit.
 */
export async function runDepositOverdue(admin: Admin): Promise<number> {
  const today = todayInPoland();
  const { data: rows } = await admin
    .from("booking_deposits")
    .select(
      "booking_id, amount, fee_amount, due_at, bookings!inner(start_date, end_date, renter_id, owner_id, status, cars(brand, model, year))"
    )
    .eq("status", "requested")
    .is("overdue_notified_at", null)
    .lt("requested_at", startOfDayInPoland(today).toISOString())
    .lte("bookings.start_date", today)
    .gte("bookings.end_date", today)
    .eq("bookings.status", "accepted")
    .limit(CRON_BATCH);

  let alerted = 0;
  for (const row of (rows ?? []) as unknown as DueDepositRow[]) {
    const { data: claimed } = await admin
      .from("booking_deposits")
      .update({ overdue_notified_at: nowIso() })
      .eq("booking_id", row.booking_id)
      .is("overdue_notified_at", null)
      .eq("status", "requested")
      .select("booking_id")
      .maybeSingle();
    if (!claimed || !row.bookings) continue;
    const label = rowLabel(row);
    const labelHtml = escapeHtml(label);
    // A deposit asked for late (the evening before pickup) is not overdue
    // for the owner's cancellation until its own deadline (depositDueAt);
    // the alarm says from when.
    const cancelFrom =
      row.due_at && new Date(row.due_at) > new Date() ? deadlineText(row.due_at) : null;
    const cancelWhen = cancelFrom ? `od ${cancelFrom} ` : "";

    await notifyUser({
      userId: row.bookings.owner_id,
      type: "deposit_overdue",
      subject: `Nie wydawaj auta — najemca nie wpłacił kaucji (${label})`,
      body: `Nie wydawaj auta ${label} — najemca nie wpłacił kaucji. Może jeszcze to zrobić, a my damy Ci znać. Jeśli nie chcesz czekać, ${cancelWhen}możesz odwołać rezerwację z powodu braku kaucji w panelu rezerwacji.`,
      emailHtml: `
        <p><strong>Nie wydawaj auta — najemca nie wpłacił kaucji.</strong></p>
        <ul>
          <li><strong>Auto:</strong> ${labelHtml}</li>
          <li><strong>Termin:</strong> ${row.bookings.start_date} – ${row.bookings.end_date}</li>
          <li><strong>Kaucja:</strong> ${formatZl(Number(row.amount))}</li>
        </ul>
        <p>Najemca może jeszcze wpłacić kaucję — wtedy od razu dostaniesz wiadomość, a on dane do odbioru.</p>
        <p>Decyzja należy do Ciebie: jeśli nie chcesz czekać, ${cancelWhen}w panelu rezerwacji możesz odwołać rezerwację z powodu niewpłaconej kaucji. Liczy się to jak anulowanie przez najemcę — zwrot za wynajem według polityki anulowania auta.</p>
        <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
      `,
      link: "/dashboard/bookings",
    });

    await notifyUser({
      userId: row.bookings.renter_id,
      type: "deposit_overdue",
      subject: `Kaucja nadal niewpłacona — właściciel nie wyda auta (${label})`,
      body: `Kaucja za ${label} wciąż nie jest wpłacona, więc właściciel nie wyda auta. Wpłać ją teraz — właściciel może też odwołać rezerwację z powodu braku kaucji.`,
      emailHtml: `
        <p><strong>Kaucja za ${labelHtml} wciąż nie jest wpłacona</strong>, więc właściciel nie wyda auta.</p>
        <p>Wpłać ją teraz kartą lub BLIK-iem. Właściciel może też odwołać rezerwację z powodu braku kaucji — wtedy zwrot za wynajem liczy się jak przy anulowaniu przez Ciebie, według polityki anulowania auta.</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Wpłać kaucję →</a></p>
      `,
      link: "/dashboard/rentals",
    });

    await notifyAdmins(admin, {
      queue: {
        type: "deposit_overdue",
        body: `Najemca nie wpłacił kaucji do dnia odbioru: ${label} (${row.bookings.start_date}, rezerwacja ${row.booking_id}). Właściciel dostał ostrzeżenie.`,
      },
      link: "/admin/kaucje",
      email: {
        subject: `Kaucja niewpłacona w dniu odbioru: ${label}`,
        intro: "Najemca nie wpłacił kaucji do dnia odbioru. Właściciel dostał ostrzeżenie, żeby nie wydawał auta, i może odwołać rezerwację. Nic nie dzieje się automatycznie.",
        rows: [
          ["Auto", label],
          ["Termin", `${row.bookings.start_date} – ${row.bookings.end_date}`],
          ["Rezerwacja", row.booking_id],
          ["Kaucja", formatZl(Number(row.amount))],
        ],
        cta: "Otwórz kaucje",
      },
    });
    alerted += 1;
  }
  return alerted;
}

/**
 * Trips whose last day has passed (or that the owner ended) start review.
 * A deposit still unpaid when the trip is over is closed the same way
 * (startDepositReview voids it): there is nothing left to secure, and the
 * renter must not be able to pay a deposit and its fee for a rental that
 * has already ended.
 */
export async function runDepositReviewStart(admin: Admin): Promise<number> {
  const today = todayInPoland();
  const [{ data: ended }, { data: completed }] = await Promise.all([
    admin
      .from("booking_deposits")
      .select("booking_id, bookings!inner(end_date, status)")
      .in("status", ["paid", "requested"])
      .lt("bookings.end_date", today)
      .in("bookings.status", ["accepted", "completed"])
      .limit(CRON_BATCH),
    // Ended by the owner, but the review never opened (the click's own
    // attempt failed midway): give it the window from now.
    admin
      .from("booking_deposits")
      .select("booking_id, bookings!inner(status)")
      .in("status", ["paid", "requested"])
      .eq("bookings.status", "completed")
      .limit(CRON_BATCH),
  ]);

  let started = 0;
  for (const row of ended ?? []) {
    await startDepositReview(admin, row.booking_id, "end_date");
    started += 1;
  }
  const seen = new Set((ended ?? []).map((row) => row.booking_id));
  for (const row of completed ?? []) {
    if (seen.has(row.booking_id)) continue;
    await startDepositReview(admin, row.booking_id, "owner");
    started += 1;
  }
  return started;
}

/** The owner said nothing within the window: the deposit goes back in full. */
export async function runDepositAutoRefunds(admin: Admin): Promise<number> {
  const { data: rows } = await admin
    .from("booking_deposits")
    .select("booking_id")
    .eq("status", "in_review")
    .lte("review_deadline", nowIso())
    .limit(CRON_BATCH);
  let refunded = 0;
  for (const row of rows ?? []) {
    const result = await refundFullDeposit(admin, row.booking_id, { decision: "auto", decidedBy: null });
    if (!result.error) refunded += 1;
  }
  return refunded;
}

/** No objection by the deadline: the kept amount goes to the owner. */
export async function runRetentionTransfers(admin: Admin): Promise<number> {
  const { data: rows } = await admin
    .from("booking_deposits")
    .select("booking_id, retained_amount")
    .eq("status", "retention_pending")
    .lte("objection_deadline", nowIso())
    .limit(CRON_BATCH);

  let transferred = 0;
  for (const row of rows ?? []) {
    const { data: claimed } = await admin
      .from("booking_deposits")
      .update({
        status: "transferring",
        transfer_amount: row.retained_amount,
        transfer_claimed_at: nowIso(),
      })
      .eq("booking_id", row.booking_id)
      .eq("status", "retention_pending")
      .lte("objection_deadline", nowIso())
      .select("booking_id")
      .maybeSingle();
    if (!claimed) continue;

    // The renter hears it before the money moves.
    const { booking } = await loadBooking(admin, row.booking_id);
    if (booking) {
      const kept = Number(row.retained_amount ?? 0);
      await notifyUser({
        userId: booking.renter_id,
        type: "deposit_captured",
        subject: `Termin sprzeciwu minął — przekazujemy zatrzymaną kaucję: ${booking.carLabel}`,
        body: `Termin na sprzeciw minął, więc zatrzymane ${formatZl(kept)} z kaucji za ${booking.carLabel} przekazujemy właścicielowi.`,
        emailHtml: `
          <p>Termin na sprzeciw minął bez zgłoszenia, więc zatrzymane <strong>${formatZl(kept)}</strong> z kaucji za <strong>${escapeHtml(booking.carLabel)}</strong> przekazujemy właścicielowi.</p>
          <p>Pytania: kontakt@gomambo.pl.</p>
        `,
        link: "/dashboard/rentals",
      });
    }

    const result = await pushRetentionTransfer(admin, row.booking_id);
    if (result.ok) transferred += 1;
  }
  return transferred;
}

/**
 * The safety net for everything above: anything a webhook, a click or a
 * crash left halfway is finished or reported here.
 */
export async function reconcileDeposits(admin: Admin): Promise<Record<string, number>> {
  const counts = { refundsSynced: 0, refundsRetried: 0, transfersRetried: 0, paymentsHealed: 0, closed: 0, holdAlerts: 0 };
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // 1. A refund that has been "on its way" for a day: ask Stripe. If no
  //    refund covers the gap at all, a crash lost it — mark it failed so
  //    step 2 sends it.
  const { data: stalePending } = await admin
    .from("booking_deposits")
    .select("*")
    .eq("refund_status", "pending")
    .lt("refund_requested_at", dayAgo)
    .neq("status", "disputed")
    // Not while a push holds the refund leg: its gap is being sent right now.
    .or(`refund_lock_until.is.null,refund_lock_until.lt."${nowIso()}"`)
    .limit(CRON_BATCH);
  for (const row of (stalePending ?? []) as BookingDeposit[]) {
    if (!row.stripe_payment_intent_id) continue;
    const summary = await getDepositRefunds(row.stripe_payment_intent_id);
    if (!summary.ok) continue;
    const covered = summary.data.succeededPln + summary.data.inFlightPln;
    if (covered + 0.005 < Number(row.refund_amount) && summary.data.inFlightPln === 0) {
      await markRefundFailed(admin, row, summary.data.lastFailure?.reason ?? "zwrot nie został zlecony w Stripe");
    } else {
      await applyRefundSummary(admin, row, summary.data);
    }
    counts.refundsSynced += 1;
  }

  // 2. Failed refunds: once a day, again.
  const { data: failedRefunds } = await admin
    .from("booking_deposits")
    .select("booking_id")
    .eq("refund_status", "failed")
    .neq("status", "disputed")
    .limit(CRON_BATCH);
  for (const row of failedRefunds ?? []) {
    const result = await retryDepositRefund(admin, row.booking_id);
    if (!result.error) counts.refundsRetried += 1;
  }

  // 3. Transfers: claimed but never recorded (a crash), or failed earlier.
  const { data: stuckTransfers } = await admin
    .from("booking_deposits")
    .select("booking_id")
    .eq("status", "transferring")
    .lt("transfer_claimed_at", hourAgo)
    .limit(CRON_BATCH);
  for (const row of stuckTransfers ?? []) {
    const result = await pushRetentionTransfer(admin, row.booking_id);
    if (result.ok) counts.transfersRetried += 1;
  }
  const { data: failedTransfers } = await admin
    .from("booking_deposits")
    .select("booking_id")
    .eq("status", "transfer_failed")
    .limit(CRON_BATCH);
  for (const row of failedTransfers ?? []) {
    const result = await retryRetentionTransfer(admin, row.booking_id);
    if (!result.error) counts.transfersRetried += 1;
  }

  // 4. A BLIK payment "processing" for a day: the event that settles it was
  //    lost. Ask Stripe what became of it.
  const { data: processing } = await admin
    .from("booking_deposits")
    .select("booking_id, stripe_checkout_session_id, stripe_payment_intent_id")
    .eq("status", "processing")
    .lt("updated_at", dayAgo)
    .limit(CRON_BATCH);
  for (const row of processing ?? []) {
    const state = await resolveProcessingDeposit(admin, row);
    if (state === "paid" || state === "failed") counts.paymentsHealed += 1;
  }

  // 5. Deposits whose booking ended some other way — a cancellation click
  //    that died between the status change and the deposit, or the renter
  //    cancelling from their own account straight through the API.
  const { data: orphaned } = await admin
    .from("booking_deposits")
    .select("booking_id, status, cancel_fee_refund, bookings!inner(status)")
    .in("status", ["requested", "paid", "in_review"])
    .in("bookings.status", ["cancelled", "declined"])
    .limit(CRON_BATCH);
  for (const row of orphaned ?? []) {
    // Every cancellation the app makes records its fee decision before it
    // flips the booking (recordDepositCancellation), so a click that died
    // halfway is finished by its own rule. With nothing recorded, the
    // database (0052) let nobody but the renter cancel, so the fee stays,
    // as when a renter cancels — and the admin is told, with a way to
    // return the fee if that was not the case.
    const recorded = row.cancel_fee_refund !== null;
    const includeFee = row.cancel_fee_refund ?? false;
    const result = await settleDepositOnCancellation(admin, row.booking_id, { includeFee });
    if (row.status !== "requested" && result.outcome !== "not_applicable") {
      await notifyAdmins(admin, {
        link: "/admin/kaucje",
        email: {
          subject: "Kaucja anulowanej rezerwacji rozliczona przez przebieg dzienny",
          intro: recorded
            ? `Anulowanie tej rezerwacji przerwało się przed rozliczeniem kaucji. Dokończyliśmy je według decyzji zapisanej przy anulowaniu: opłata za obsługę kaucji ${includeFee ? "wraca do najemcy" : "zostaje (anulowanie z winy najemcy)"}.`
            : "Rezerwacja została anulowana poza aplikacją (bez zapisanej decyzji o opłacie — tak może anulować tylko najemca ze swojego konta), a wpłacona kaucja wciąż była u nas. Zwróciliśmy ją bez opłaty za obsługę. Jeśli to nie najemca anulował, zwróć opłatę przyciskiem „Zwróć opłatę za obsługę” w panelu kaucji.",
          rows: [
            ["Rezerwacja", row.booking_id],
            ["Wynik", result.outcome],
            ["Kaucja", formatZl(result.amountPln)],
            ["Opłata za obsługę zwrócona", formatZl(result.feePln)],
          ],
          cta: "Otwórz kaucje",
        },
      });
    }
    counts.closed += 1;
  }

  // 6. Stripe lets a platform keep funds for 90 days; warn at 80, once.
  const { data: longHeld } = await admin
    .from("booking_deposits")
    .select("booking_id, status, paid_at")
    .in("status", ["paid", "in_review", "retention_pending", "retention_objected", "transfer_failed", "disputed"])
    .lt("paid_at", new Date(Date.now() - 80 * DAY_MS).toISOString())
    .is("hold_alerted_at", null)
    .limit(CRON_BATCH);
  for (const row of longHeld ?? []) {
    const { data: claimed } = await admin
      .from("booking_deposits")
      .update({ hold_alerted_at: nowIso() })
      .eq("booking_id", row.booking_id)
      .is("hold_alerted_at", null)
      .select("booking_id")
      .maybeSingle();
    if (!claimed) continue;
    await notifyAdmins(admin, {
      queue: {
        type: "deposit_overdue",
        body: `Kaucja do rezerwacji ${row.booking_id} jest u nas od ponad 80 dni (${DEPOSIT_STATE_LABELS[row.status as DepositState] ?? row.status}). Stripe pozwala trzymać środki najwyżej 90 dni — rozlicz ją.`,
      },
      link: "/admin/kaucje",
      email: {
        subject: "Kaucja trzymana ponad 80 dni",
        intro: "Stripe pozwala platformie trzymać środki najwyżej 90 dni. Ta kaucja jest u nas od ponad 80 — rozlicz ją, zanim termin minie.",
        rows: [
          ["Rezerwacja", row.booking_id],
          ["Stan", DEPOSIT_STATE_LABELS[row.status as DepositState] ?? row.status],
          ["Wpłacona", row.paid_at ? formatDateTimePl(row.paid_at) : null],
        ],
        cta: "Otwórz kaucje",
      },
    });
    counts.holdAlerts += 1;
  }

  return counts;
}
