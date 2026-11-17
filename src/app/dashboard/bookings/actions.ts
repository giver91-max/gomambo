"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { cancelBookingWithRefund, renterRefundSentence } from "@/lib/cancellation";
import { hasOverlappingBooking } from "@/lib/booking-availability";
import { createExtraChargeCheckoutSession } from "@/lib/stripe";
import {
  closeDepositSession,
  refundFullDeposit,
  renterDepositSentence,
  retainDeposit,
  startDepositReview,
} from "@/lib/deposit-service";
import { formatDateTimePl, todayInPoland } from "@/lib/calendar";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import type { BookingDeposit, BookingStatus, CancellationPolicy } from "@/types/database";
import { formatZl } from "@/lib/deposit";

// A retention reason is shown to the renter and kept as GoMambo's case
// record; long enough for a real description, short enough for a mail.
const MAX_RETENTION_REASON = 2000;

export async function updateBookingStatus(
  bookingId: string,
  status: Extract<BookingStatus, "accepted" | "declined" | "completed">
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "car_id, status, owner_id, renter_id, start_date, end_date, cars(brand, model, year)"
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }

  // Which transitions are legal. Until Partner cars existed every booking was
  // born 'accepted', so the Accept button never rendered for a dead one and
  // nothing checked — the database trigger (0036) let an owner move their
  // own booking anywhere. Now 'requested' is a real state, and without this a
  // cancelled or declined booking could be resurrected with one click. Since
  // 0052 the trigger allows an owner exactly these moves too, so the two must
  // stay in step.
  const ALLOWED: Record<string, string[]> = {
    requested: ["accepted", "declined"],
    accepted: ["completed"],
  };
  if (!ALLOWED[booking.status]?.includes(status)) {
    return { error: "Tej rezerwacji nie można już zmienić." };
  }

  if (status === "accepted") {
    if (booking.start_date < new Date().toISOString().slice(0, 10)) {
      return { error: "Termin tej rezerwacji już minął — nie można jej potwierdzić." };
    }
    // The overlap guard in sendInquiry only counts accepted/completed
    // bookings, which is correct: several customers may REQUEST the same
    // dates. Confirmation is where that has to be resolved, or a Partner
    // could accept two requests for the same car and the same week.
    if (await hasOverlappingBooking(booking.car_id, booking.start_date, booking.end_date, bookingId)) {
      return {
        error:
          "Ten termin jest już zajęty przez potwierdzoną rezerwację tego auta. Odrzuć to zapytanie albo zaproponuj inny termin.",
      };
    }
  }

  const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
  if (error) {
    return { error: error.message };
  }

  // The car is back: the owner's DEPOSIT_REVIEW_DAYS to check it start now.
  // Nothing goes back yet — the owner confirms ("Auto w porządku") or keeps
  // part of it, and silence returns it after the window (daily job).
  // Service role: the deposit row has no session-writable policy at all.
  if (status === "completed") {
    await startDepositReview(createAdminClient(), bookingId, "owner");
  }

  if (status === "accepted" || status === "declined") {
    const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
    const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
    await notifyUser({
      userId: booking.renter_id,
      type: status === "accepted" ? "booking_accepted" : "booking_declined",
      subject:
        status === "accepted"
          ? `Rezerwacja zaakceptowana: ${carLabel}`
          : `Rezerwacja odrzucona: ${carLabel}`,
      body:
        status === "accepted"
          ? `Właściciel zaakceptował Twoje zapytanie o ${carLabel} (${booking.start_date} – ${booking.end_date}).`
          : `Właściciel odrzucił Twoje zapytanie o ${carLabel} (${booking.start_date} – ${booking.end_date}).`,
      emailHtml:
        status === "accepted"
          ? `
            <p>Właściciel zaakceptował Twoje zapytanie o wynajem na GoMambo.</p>
            <ul>
              <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
              <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
            </ul>
            <p><a href="https://www.gomambo.pl/dashboard/rentals">Zobacz szczegóły →</a></p>
          `
          : `
            <p>Właściciel odrzucił Twoje zapytanie o wynajem na GoMambo.</p>
            <ul>
              <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
              <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
            </ul>
            <p>Przejrzyj inne dostępne auta w Twojej okolicy.</p>
            <p><a href="https://www.gomambo.pl/auta">Przeglądaj auta →</a></p>
          `,
      link: "/dashboard/rentals",
    });
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}

export async function cancelBooking(bookingId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `renter_id, owner_id, status, start_date, end_date,
       payment_status, payment_method, stripe_checkout_session_id,
       cars(brand, model, year, cancellation_policy)`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) return;
  if (booking.status !== "requested" && booking.status !== "accepted") return;
  // PAY-1: from the start date on the car may already be with the renter,
  // and a "cancellation" is then a dispute only GoMambo can settle. The
  // button is gone from that day and the database trigger refuses it too.
  if (booking.start_date <= todayInPoland()) return;

  const policy: CancellationPolicy =
    (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
      ?.cancellation_policy ?? "moderate";
  // The renter's own decision: the fee for handling the deposit stays.
  const cancellation = await cancelBookingWithRefund(
    createAdminClient(),
    bookingId,
    {
      start_date: booking.start_date,
      payment_status: booking.payment_status,
      payment_method: booking.payment_method,
      stripe_checkout_session_id: booking.stripe_checkout_session_id,
      cancellation_policy: policy,
    },
    { depositFeeRefund: false }
  );

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  await notifyUser({
    userId: booking.owner_id,
    type: "booking_cancelled",
    subject: `Rezerwacja anulowana: ${carLabel}`,
    body: `Najemca anulował rezerwację ${carLabel} (${booking.start_date} – ${booking.end_date}).`,
    emailHtml: `
      <p>Najemca anulował rezerwację na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
        <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
      </ul>
      <p><a href="https://www.gomambo.pl/dashboard/bookings">Zobacz rezerwacje →</a></p>
    `,
    link: "/dashboard/bookings",
  });

  // Paid by bank transfer: the card path's automatic refund doesn't exist
  // here, and payment_status deliberately stays 'paid', so without this the
  // renter's own screen would say "Opłacono" next to "Anulowana" and nothing
  // would ever mention their money.
  if (cancellation.refund === "manual_refund_required") {
    await notifyUser({
      userId: user.id,
      type: "booking_cancelled",
      subject: `Rezerwacja anulowana: ${carLabel} — zwrot przelewem`,
      body: `Rezerwacja ${carLabel} została anulowana.${renterRefundSentence(cancellation.refund)}`,
      emailHtml: `
        <p>Twoja rezerwacja na GoMambo została anulowana.</p>
        <ul>
          <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
          <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
        </ul>
        <p>Wpłatę zwrócimy przelewem na konto, z którego przyszła — odezwiemy się do Ciebie. Pytania: kontakt@gomambo.pl.</p>
      `,
      link: "/dashboard/rentals",
    });
  }

  // A deposit paid before the cancellation goes back by itself; say so, and
  // say how much — the fee for handling it stays when the renter cancels
  // (renterDepositSentence names both, so the mail never contradicts it).
  const depositLine = renterDepositSentence(cancellation.deposit);
  if (depositLine) {
    const moneyMoving =
      cancellation.deposit.outcome === "refunded" || cancellation.deposit.outcome === "pending_payment";
    await notifyUser({
      userId: user.id,
      type: "deposit_refunded",
      subject: `Kaucja za anulowaną rezerwację: ${carLabel}`,
      body: `Rezerwacja ${carLabel} została anulowana.${depositLine}`,
      emailHtml: `
        <p>Twoja rezerwacja na GoMambo (${escapeHtml(carLabel)}, ${booking.start_date} – ${booking.end_date}) została anulowana.${escapeHtml(depositLine)}</p>
        ${moneyMoving ? "<p>Zwrot na BLIK dociera zwykle w ciągu 2 godzin, na kartę do 10 dni roboczych.</p>" : ""}
      `,
      link: "/dashboard/rentals",
    });
  }

  // The booking is cancelled either way; don't let the renter assume the
  // money is on its way when Stripe rejected the refund — or when only the
  // base fee came back and a paid extension didn't.
  if (cancellation.refund === "failed" || cancellation.refund === "partially_refunded") {
    await notifyUser({
      userId: user.id,
      type: "booking_cancelled",
      subject: `Rezerwacja anulowana: ${carLabel} — zwrot w toku`,
      body: `Rezerwacja ${carLabel} została anulowana, ale automatyczny zwrot płatności nie powiódł się w całości. Wykonamy go ręcznie i potwierdzimy — nie musisz nic robić.`,
      emailHtml: `
        <p>Twoja rezerwacja na GoMambo została anulowana, ale automatyczny zwrot płatności nie powiódł się w całości.</p>
        <ul>
          <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
          <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
        </ul>
        <p>Zwrot wykonamy ręcznie i potwierdzimy osobno — nie musisz nic robić. Pytania: kontakt@gomambo.pl.</p>
      `,
      link: "/dashboard/rentals",
    });
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
}

// Instant book removed the owner's one point of control (manually
// declining before accepting) — this is the replacement: an owner can
// still back out of an already-confirmed booking, but only before the
// trip starts, and always with a full refund (forceFullRefund: true).
// The free-cancellation window exists to protect the owner from a late
// renter cancellation; it has no bearing on the owner cancelling on the
// renter, so it's never applied here.
export async function ownerCancelBooking(bookingId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `owner_id, renter_id, status, start_date, end_date,
       payment_status, payment_method, stripe_checkout_session_id,
       cars(brand, model, year, cancellation_policy)`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted") {
    return { error: "Można odwołać tylko potwierdzoną rezerwację." };
  }
  if (booking.start_date <= todayInPoland()) {
    return { error: "Nie można odwołać rezerwacji, która już się rozpoczęła." };
  }

  const policy: CancellationPolicy =
    (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
      ?.cancellation_policy ?? "moderate";
  // Not the renter's doing, so the deposit comes back with its fee.
  const cancellation = await cancelBookingWithRefund(
    createAdminClient(),
    bookingId,
    {
      start_date: booking.start_date,
      payment_status: booking.payment_status,
      payment_method: booking.payment_method,
      stripe_checkout_session_id: booking.stripe_checkout_session_id,
      cancellation_policy: policy,
    },
    { forceFullRefund: true, depositFeeRefund: true }
  );

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  // Only promise the renter money that's actually moving — a paid extension
  // that failed to refund makes "pełny zwrot" false (see renterRefundSentence).
  const refundLine =
    renterRefundSentence(cancellation.refund) + renterDepositSentence(cancellation.deposit);
  await notifyUser({
    userId: booking.renter_id,
    type: "booking_cancelled",
    subject: `Rezerwacja odwołana: ${carLabel}`,
    body: `Właściciel odwołał rezerwację ${carLabel} (${booking.start_date} – ${booking.end_date}).${refundLine}`,
    emailHtml: `
      <p>Właściciel odwołał Twoją rezerwację na GoMambo.${escapeHtml(refundLine)}</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
        <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
      </ul>
      <p><a href="https://www.gomambo.pl/auta">Przeglądaj inne auta →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}

export async function submitReview(
  bookingId: string,
  rating: number,
  comment: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Wybierz ocenę od 1 do 5." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("owner_id, renter_id, status, car_id")
    .eq("id", bookingId)
    .single();

  if (!booking || (booking.owner_id !== user.id && booking.renter_id !== user.id)) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "completed") {
    return { error: "Można ocenić tylko zakończone wypożyczenie." };
  }

  const revieweeId = booking.owner_id === user.id ? booking.renter_id : booking.owner_id;
  const trimmedComment = comment.trim();

  const { error } = await supabase.from("reviews").insert({
    booking_id: bookingId,
    reviewer_id: user.id,
    reviewee_id: revieweeId,
    rating,
    comment: trimmedComment || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "To wypożyczenie ma już Twoją ocenę." };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  revalidatePath(`/auta/${booking.car_id}`);
  return { error: null };
}

/**
 * The owner keeps part (or all) of the paid deposit for damage — the name
 * and the owner's right stay from the card-hold days, the mechanics are
 * Rafał's new rules (see retainDeposit): the rest goes back to the renter at
 * once, the kept part waits for the renter's objection before it reaches
 * the owner. Allowed from the start date until the review window closes.
 * The reason is required: it is what the renter may object to and what
 * GoMambo decides on; photos go into the trip's return photos.
 */
export async function captureDepositForDamage(
  bookingId: string,
  amountPln: number,
  reason: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(amountPln > 0)) {
    return { error: "Podaj kwotę większą od zera." };
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "Opisz szkodę — najemca i GoMambo zobaczą ten powód." };
  }
  if (trimmedReason.length > MAX_RETENTION_REASON) {
    return { error: `Opis jest za długi — zmieść się w ${MAX_RETENTION_REASON} znakach.` };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("owner_id, status")
    .eq("id", bookingId)
    .single();
  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted" && booking.status !== "completed") {
    return { error: "Tej rezerwacji nie można już rozliczyć." };
  }

  const result = await retainDeposit(createAdminClient(), bookingId, {
    amountPln,
    reason: trimmedReason,
    ownerId: user.id,
  });
  if (result.error) return result;

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}

/**
 * "Auto w porządku — zwróć kaucję": the owner has checked the car, the
 * whole deposit goes back now and the rental is closed. From the start date
 * on (before it there was no car to check) — also how an owner settles a
 * no-show: "Zakończ", then this.
 */
export async function confirmVehicleOk(bookingId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select("owner_id, status, start_date")
    .eq("id", bookingId)
    .single();
  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted" && booking.status !== "completed") {
    return { error: "Tej rezerwacji nie można już rozliczyć." };
  }

  const admin = createAdminClient();
  const { data: deposit } = await admin
    .from("booking_deposits")
    .select("status")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (deposit?.status === "paid" && booking.start_date > todayInPoland()) {
    return {
      error:
        "Auto jeszcze nie zostało wydane. Jeśli najemca się nie pojawi, najpierw zakończ wypożyczenie.",
    };
  }

  const result = await refundFullDeposit(admin, bookingId, {
    decision: "vehicle_ok",
    decidedBy: user.id,
  });
  if (result.error) return result;

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}

/**
 * Pickup day has come and the deposit has not. Rafał's rule: nothing is
 * cancelled automatically, the owner decides — and if they cancel, it counts
 * as the renter's cancellation, so the rental refund follows the car's
 * cancellation policy (forceFullRefund off) and no deposit fee comes back.
 *
 * Only once the renter's deadline (booking_deposits.due_at) has passed: for a
 * trip booked or paid late the deposit is asked for on the evening before or
 * on pickup day itself, and the renter gets a real window from that moment
 * (depositDueAt) — not a minute before the owner may cancel and keep the
 * rental money.
 */
export async function ownerCancelForUnpaidDeposit(
  bookingId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `owner_id, renter_id, status, start_date, end_date,
       payment_status, payment_method, stripe_checkout_session_id,
       cars(brand, model, year, cancellation_policy)`
    )
    .eq("id", bookingId)
    .single();
  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted") {
    return { error: "Można odwołać tylko potwierdzoną rezerwację." };
  }
  if (booking.start_date > todayInPoland()) {
    return { error: "Najemca ma czas na wpłatę kaucji do końca dnia przed odbiorem." };
  }

  const admin = createAdminClient();
  const { data: depositRow } = await admin
    .from("booking_deposits")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const deposit = depositRow as BookingDeposit | null;
  if (!deposit || deposit.status !== "requested") {
    return { error: "Kaucja nie czeka na wpłatę — odśwież stronę." };
  }
  if (!deposit.due_at || new Date(deposit.due_at) > new Date()) {
    return {
      error: deposit.due_at
        ? `Najemca ma czas na wpłatę kaucji do ${formatDateTimePl(deposit.due_at)} — dopiero potem możesz odwołać rezerwację.`
        : "Nie udało się ustalić terminu wpłaty kaucji — napisz do nas.",
    };
  }

  // Before anything is cancelled: if the renter paid a moment ago, that
  // payment is recorded here and the booking stays.
  const session = await closeDepositSession(admin, deposit);
  if (session === "paid") {
    revalidatePath("/dashboard/bookings");
    return { error: "Najemca właśnie wpłacił kaucję — rezerwacja zostaje. Odśwież stronę." };
  }
  if (session === "blocked") {
    return { error: "Nie udało się sprawdzić płatności kaucji. Spróbuj ponownie za chwilę." };
  }

  // Voided together with the fee decision (the renter's doing: the fee
  // stays), so a payment that still lands on it is judged by that rule; and
  // only while the deadline checked above still holds — and while the row
  // still names the payment page just closed. payDeposit records a new page
  // under the same condition, so if the renter opened one meanwhile this
  // misses and nothing is cancelled; the owner's next click closes it first.
  const voidClaim = admin
    .from("booking_deposits")
    .update({ status: "voided", cancel_fee_refund: false })
    .eq("booking_id", bookingId)
    .eq("status", "requested")
    .lte("due_at", new Date().toISOString());
  const { data: voided } = await (deposit.stripe_checkout_session_id
    ? voidClaim.eq("stripe_checkout_session_id", deposit.stripe_checkout_session_id)
    : voidClaim.is("stripe_checkout_session_id", null)
  )
    .select("booking_id")
    .maybeSingle();
  if (!voided) {
    return { error: "Stan kaucji właśnie się zmienił — odśwież stronę." };
  }

  const policy: CancellationPolicy =
    (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
      ?.cancellation_policy ?? "moderate";
  const cancellation = await cancelBookingWithRefund(
    admin,
    bookingId,
    {
      start_date: booking.start_date,
      payment_status: booking.payment_status,
      payment_method: booking.payment_method,
      stripe_checkout_session_id: booking.stripe_checkout_session_id,
      cancellation_policy: policy,
    },
    { depositFeeRefund: false }
  );

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  const refundLine = renterRefundSentence(cancellation.refund);
  await notifyUser({
    userId: booking.renter_id,
    type: "booking_cancelled",
    subject: `Rezerwacja odwołana — niewpłacona kaucja: ${carLabel}`,
    body: `Właściciel odwołał rezerwację ${carLabel} (${booking.start_date} – ${booking.end_date}), bo kaucja nie została wpłacona w terminie. Zwrot za wynajem liczy się jak przy anulowaniu przez najemcę.${refundLine}`,
    emailHtml: `
      <p>Właściciel odwołał Twoją rezerwację, bo kaucja nie została wpłacona w terminie.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
        <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
      </ul>
      <p>Zwrot za wynajem liczy się jak przy anulowaniu przez najemcę, według polityki anulowania auta.${escapeHtml(refundLine)}</p>
      <p>Pytania: kontakt@gomambo.pl.</p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}

// Damage above the held deposit — can never be an automatic card charge
// (no saved Stripe Customer/PaymentMethod exists, and BLIK — Poland's
// dominant payment method — can't support one anyway), so this creates a
// fresh Checkout Session the renter must pay themselves. No platform fee:
// this is compensation for the owner's loss, not a rental fee.
export async function requestExtraCharge(
  bookingId: string,
  amountPln: number,
  reason: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(amountPln > 0)) {
    return { error: "Podaj kwotę większą od zera." };
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "Podaj powód dodatkowej opłaty." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `owner_id, renter_id, status,
       cars(brand, model, owner:profiles!cars_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded))`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted" && booking.status !== "completed") {
    return { error: "Można zgłosić dopłatę tylko dla potwierdzonego lub zakończonego wynajmu." };
  }

  const car = booking.cars as unknown as {
    brand: string;
    model: string;
    owner: { stripe_connect_account_id: string | null; stripe_connect_onboarded: boolean } | null;
  } | null;
  if (!car) {
    return { error: "Nie znaleziono auta." };
  }
  // Stripe Connect is NOT required to raise the charge — the renter can
  // settle it by bank transfer, which needs no payout account at all. It is
  // only needed to pre-create the card Checkout session below.
  const connectReady =
    !!car.owner?.stripe_connect_account_id && car.owner.stripe_connect_onboarded;

  const admin = createAdminClient();
  const { data: renterAuth } = await admin.auth.admin.getUserById(booking.renter_id);
  const renterEmail = renterAuth?.user?.email ?? "";

  const { data: extraCharge, error: insertError } = await admin
    .from("booking_extra_charges")
    .insert({ booking_id: bookingId, amount_pln: amountPln, reason: trimmedReason })
    .select("id")
    .single();
  if (insertError || !extraCharge) {
    return { error: insertError?.message ?? "Nie udało się zapisać zgłoszenia." };
  }

  if (connectReady) {
    const checkoutResult = await createExtraChargeCheckoutSession({
      bookingId,
      extraChargeId: extraCharge.id,
      ownerStripeAccountId: car.owner!.stripe_connect_account_id!,
      amountPln,
      description: `Dodatkowa opłata: ${car.brand} ${car.model}`,
      renterEmail,
      successUrl: `${SITE_URL}/dashboard/rentals?extra_charge=success`,
      cancelUrl: `${SITE_URL}/dashboard/rentals?extra_charge=cancelled`,
    });
    // A failed session is not fatal any more: the charge row already exists
    // and the renter can still pay it by transfer, or retry the card from
    // their own screen (payExtraCharge re-creates the session).
    if (checkoutResult.ok) {
      await admin
        .from("booking_extra_charges")
        .update({ stripe_checkout_session_id: checkoutResult.data.sessionId })
        .eq("id", extraCharge.id);
    } else {
      console.error("requestExtraCharge: checkout session failed", checkoutResult.error);
    }
  }

  const carLabel = `${car.brand} ${car.model}`;
  await notifyUser({
    userId: booking.renter_id,
    type: "extra_charge_requested",
    subject: `Prośba o dopłatę: ${carLabel}`,
    body: `Właściciel prosi o dopłatę ${formatZl(amountPln)} za ${carLabel}. Powód: ${trimmedReason}`,
    emailHtml: `
      <p>Właściciel prosi o dodatkową opłatę za wynajem na GoMambo, ponad kaucję.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
        <li><strong>Kwota:</strong> ${formatZl(amountPln)}</li>
        <li><strong>Powód:</strong> ${escapeHtml(trimmedReason)}</li>
      </ul>
      <p>Jeśli się z tym nie zgadzasz, napisz do nas przez czat — decyzję można cofnąć tylko ręcznie.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Zapłać lub zobacz szczegóły →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  return { error: null };
}
