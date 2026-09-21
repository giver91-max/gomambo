"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCommission, calculateBookingPrice } from "@/lib/pricing";
import { hasOverlappingBooking } from "@/lib/booking-availability";
import { addDays, toISODate } from "@/lib/calendar";
import {
  createDepositCheckoutSession,
  createExtraChargeCheckoutSession,
  createRentalCheckoutSession,
  expireCheckoutSession,
  getCheckoutSessionPayment,
  refundCheckoutSession,
} from "@/lib/stripe";
import { getOwnerCommissionRate } from "@/lib/commission";
import { reportMoneyFailure } from "@/lib/money-alerts";
import { notifyUser } from "@/lib/notify-user";
import { SITE_URL } from "@/lib/site";

type PreviousSessionState =
  | { kind: "clear" }
  | {
      kind: "paid";
      sessionId: string;
      amountTotalPln: number | null;
      applicationFeePln: number | null;
    }
  | { kind: "blocked"; error: string };

function sessionWasPaid(data: {
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
async function settlePreviousSession(sessionId: string | null): Promise<PreviousSessionState> {
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

export async function createBookingCheckoutSession(
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
      `id, owner_id, renter_id, status, payment_status, start_date, end_date,
       stripe_checkout_session_id,
       cars(brand, model, price_per_day, price_per_month, security_deposit_amount,
            owner:profiles!cars_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded))`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted") {
    return { error: "Ta rezerwacja nie jest jeszcze zaakceptowana przez właściciela." };
  }
  if (booking.payment_status !== "unpaid") {
    return { error: "Ta rezerwacja została już opłacona." };
  }

  const car = booking.cars as unknown as {
    brand: string;
    model: string;
    price_per_day: number;
    price_per_month: number | null;
    security_deposit_amount: number | null;
    owner: { stripe_connect_account_id: string | null; stripe_connect_onboarded: boolean } | null;
  } | null;

  if (!car?.owner?.stripe_connect_account_id || !car.owner.stripe_connect_onboarded) {
    return {
      error: "Właściciel nie ukończył konfiguracji wypłat. Spróbuj ponownie później.",
    };
  }

  const admin = createAdminClient();

  const previous = await settlePreviousSession(booking.stripe_checkout_session_id);
  if (previous.kind === "blocked") {
    return { error: previous.error };
  }
  if (previous.kind === "paid") {
    // Stripe says this booking was already paid but the row still says
    // otherwise — the webhook never arrived. Record it here instead of
    // dead-ending the renter behind "already paid, refresh" forever.
    const { data: healed } = await admin
      .from("bookings")
      .update({
        payment_status: "paid",
        stripe_checkout_session_id: previous.sessionId,
        ...(previous.amountTotalPln !== null ? { total_price: previous.amountTotalPln } : {}),
        ...(previous.applicationFeePln !== null
          ? { platform_fee_amount: previous.applicationFeePln }
          : {}),
      })
      .eq("id", bookingId)
      .eq("payment_status", "unpaid")
      .select("id")
      .single();

    // Only notify if this call is the one that flipped the row — a webhook
    // landing concurrently must not produce a second owner notification.
    if (healed) {
      await notifyUser({
        userId: booking.owner_id,
        type: "booking_paid",
        subject: "Płatność za wynajem otrzymana",
        body: `Najemca opłacił wynajem ${car.brand} ${car.model}. Rezerwacja jest potwierdzona.`,
        emailHtml: `
          <p>Najemca opłacił rezerwację — ${car.brand} ${car.model}.</p>
          <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
        `,
        link: "/dashboard/bookings",
      });
    }
    revalidatePath("/dashboard/rentals");
    redirect(`${SITE_URL}/dashboard/rentals?payment=success`);
  }

  const { total: rentalTotal } = calculateBookingPrice(
    Number(car.price_per_day),
    car.price_per_month !== null ? Number(car.price_per_month) : null,
    booking.start_date,
    booking.end_date
  );
  // The renter pays the owner's price plus the platform fee; the owner is
  // transferred their full listed price.
  const { commission: platformFee, gross } = applyCommission(
    rentalTotal,
    await getOwnerCommissionRate(booking.owner_id, { bookingId })
  );
  const ownerAccountId = car.owner.stripe_connect_account_id;
  const renterEmail = user.email ?? "";

  const finalSuccessUrl = `${SITE_URL}/dashboard/rentals?payment=success`;
  const cancelUrl = `${SITE_URL}/dashboard/rentals?payment=cancelled`;

  let depositUrl: string | null = null;
  const depositAmount = car.security_deposit_amount !== null ? Number(car.security_deposit_amount) : null;

  if (depositAmount && depositAmount > 0) {
    const depositResult = await createDepositCheckoutSession({
      bookingId,
      ownerStripeAccountId: ownerAccountId,
      depositAmountPln: depositAmount,
      renterEmail,
      successUrl: finalSuccessUrl,
      cancelUrl,
    });
    if (!depositResult.ok) {
      return { error: depositResult.error };
    }
    depositUrl = depositResult.data.url;
  }

  const rentalResult = await createRentalCheckoutSession({
    bookingId,
    ownerStripeAccountId: ownerAccountId,
    totalPricePln: gross,
    platformFeePln: platformFee,
    description: `Wynajem: ${car.brand} ${car.model}`,
    renterEmail,
    successUrl: depositUrl ?? finalSuccessUrl,
    cancelUrl,
  });
  if (!rentalResult.ok) {
    return { error: rentalResult.error };
  }

  // Uses the admin client only for these writes: total_price/deposit
  // fields aren't user-editable anywhere, so there's no RLS reason to
  // route them through the session client, and it keeps this action
  // consistent with the rest of the money-writing code paths.
  const { error: bookingUpdateError } = await admin
    .from("bookings")
    .update({
      total_price: gross,
      platform_fee_amount: platformFee,
      stripe_checkout_session_id: rentalResult.data.sessionId,
      ...(depositAmount && depositAmount > 0 ? { deposit_amount: depositAmount } : {}),
    })
    .eq("id", bookingId);
  // Without this row the webhook can't match the payment to the booking and
  // the fee can't be reconciled — better to have the renter retry than to
  // send them to Stripe for a charge nothing tracks. The unused Checkout
  // Session simply expires.
  if (bookingUpdateError) {
    console.error("createBookingCheckoutSession: booking update failed", bookingUpdateError);
    return { error: "Nie udało się zapisać płatności. Spróbuj ponownie za chwilę." };
  }

  redirect(rentalResult.data.url);
}

// Extending an already-accepted, already-paid booking — auto-approved if
// the extra nights are free (same instant-book philosophy as the initial
// booking, reusing the same overlap guard), no separate owner-approval
// step. end_date/total_price on the booking itself are only bumped once
// Stripe confirms payment (webhook, kind === "trip_extension") — never
// optimistically, so an extension can never exist without being paid for.
export async function requestBookingExtension(
  bookingId: string,
  newEndDate: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `id, car_id, owner_id, renter_id, status, payment_status, start_date, end_date, total_price,
       cars(brand, model, price_per_day, price_per_month,
            owner:profiles!cars_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded))`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted") {
    return { error: "Można przedłużyć tylko potwierdzoną rezerwację." };
  }
  if (booking.payment_status !== "paid" || booking.total_price === null) {
    return { error: "Można przedłużyć tylko już opłaconą rezerwację." };
  }
  if (newEndDate <= booking.end_date) {
    return { error: "Nowa data zakończenia musi być późniejsza niż obecna." };
  }

  const deltaStart = toISODate(addDays(new Date(`${booking.end_date}T00:00:00`), 1));
  if (await hasOverlappingBooking(booking.car_id, deltaStart, newEndDate, bookingId)) {
    return { error: "Te dodatkowe dni są już zarezerwowane przez kogoś innego." };
  }

  const car = booking.cars as unknown as {
    brand: string;
    model: string;
    price_per_day: number;
    price_per_month: number | null;
    owner: { stripe_connect_account_id: string | null; stripe_connect_onboarded: boolean } | null;
  } | null;

  if (!car?.owner?.stripe_connect_account_id || !car.owner.stripe_connect_onboarded) {
    return { error: "Właściciel nie ukończył konfiguracji wypłat. Spróbuj ponownie później." };
  }

  const pricePerDay = Number(car.price_per_day);
  const pricePerMonth = car.price_per_month !== null ? Number(car.price_per_month) : null;
  const { total: currentRental } = calculateBookingPrice(
    pricePerDay,
    pricePerMonth,
    booking.start_date,
    booking.end_date
  );
  const { total: newRental } = calculateBookingPrice(
    pricePerDay,
    pricePerMonth,
    booking.start_date,
    newEndDate
  );
  // Recomputed from the dates rather than from bookings.total_price: that
  // column holds the GROSS amount (owner's price + platform fee), so
  // subtracting it from a rental total would mix the two and undercharge.
  const additionalRental = Math.round((newRental - currentRental) * 100) / 100;
  if (additionalRental <= 0) {
    return { error: "Nie udało się wyliczyć dopłaty za przedłużenie." };
  }
  const { commission: platformFee, gross: additionalGross } = applyCommission(
    additionalRental,
    await getOwnerCommissionRate(booking.owner_id, { bookingId })
  );

  const admin = createAdminClient();

  // Same stale-session hazard as the initial payment: an earlier "Przedłuż"
  // attempt left an open Checkout Session that is still payable. Expire it
  // before creating another, so only one extension can ever be paid.
  const { data: stale } = await admin
    .from("booking_extensions")
    .select("id, stripe_checkout_session_id")
    .eq("booking_id", bookingId)
    .eq("status", "pending")
    .not("stripe_checkout_session_id", "is", null);
  for (const row of stale ?? []) {
    const state = await settlePreviousSession(row.stripe_checkout_session_id);
    if (state.kind === "blocked") {
      return { error: state.error };
    }
    if (state.kind === "paid") {
      // Paid but never applied — the webhook was lost. Applying it now would
      // be unsafe: days that were free when they paid may since have been
      // booked by someone else. Give the money back instead, so the renter
      // can simply extend again, rather than stranding them with a charge
      // and no extension.
      const refund = await refundCheckoutSession(state.sessionId);
      await admin
        .from("booking_extensions")
        .update({
          status: "expired",
          ...(refund.ok ? { refunded_at: new Date().toISOString() } : {}),
        })
        .eq("id", row.id);
      if (!refund.ok) {
        await reportMoneyFailure(
          "refund_failed",
          `Przedłużenie ${row.id} (rezerwacja ${bookingId}) zostało opłacone sesją ${state.sessionId}, nigdy nie zostało zastosowane, a automatyczny zwrot się nie powiódł (${refund.error}). Zwróć tę płatność ręcznie w Stripe.`
        );
        return {
          error:
            "Poprzednia płatność za przedłużenie nie została zaksięgowana. Zgłosiliśmy to — odezwiemy się do Ciebie.",
        };
      }
      return {
        error:
          "Poprzednia płatność za przedłużenie nie została zaksięgowana, więc ją zwróciliśmy. Spróbuj przedłużyć wynajem jeszcze raz.",
      };
    }
    // Always 'expired': the webhook refuses to apply a non-pending row, and
    // refunds anything that still gets paid on it.
    await admin.from("booking_extensions").update({ status: "expired" }).eq("id", row.id);
  }

  const { data: extension, error: extensionError } = await admin
    .from("booking_extensions")
    .insert({
      booking_id: bookingId,
      new_end_date: newEndDate,
      additional_amount_pln: additionalGross,
    })
    .select("id")
    .single();
  if (extensionError || !extension) {
    return { error: extensionError?.message ?? "Nie udało się utworzyć prośby o przedłużenie." };
  }

  const successUrl = `${SITE_URL}/dashboard/rentals?extension=success`;
  const cancelUrl = `${SITE_URL}/dashboard/rentals?extension=cancelled`;

  const checkoutResult = await createRentalCheckoutSession({
    bookingId,
    ownerStripeAccountId: car.owner.stripe_connect_account_id,
    totalPricePln: additionalGross,
    platformFeePln: platformFee,
    description: `Przedłużenie wynajmu: ${car.brand} ${car.model}`,
    renterEmail: user.email ?? "",
    successUrl,
    cancelUrl,
    metadata: { kind: "trip_extension", extensionId: extension.id },
  });
  if (!checkoutResult.ok) {
    // The row was inserted before Stripe was called; don't leave an orphan
    // extension with no session behind every failed attempt.
    await admin.from("booking_extensions").delete().eq("id", extension.id);
    return { error: checkoutResult.error };
  }

  // platform_fee_pln is the only record of what Stripe took on an extension
  // (bookings.platform_fee_amount covers just the initial payment) — with
  // per-owner rates that's what makes a promo reconcilable.
  await admin
    .from("booking_extensions")
    .update({ stripe_checkout_session_id: checkoutResult.data.sessionId, platform_fee_pln: platformFee })
    .eq("id", extension.id);

  redirect(checkoutResult.data.url);
}

// Generates a fresh Checkout Session on every click rather than reusing the
// one created when the owner first requested the charge — Checkout
// Sessions expire (~24h), and the renter may not pay right away, so
// re-creating avoids ever handing back a dead link.
export async function payExtraCharge(extraChargeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: extraCharge } = await supabase
    .from("booking_extra_charges")
    .select(
      `id, booking_id, amount_pln, reason, status, stripe_checkout_session_id,
       bookings(renter_id, owner_id,
         cars(brand, model, owner:profiles!cars_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded)))`
    )
    .eq("id", extraChargeId)
    .single();

  const booking = extraCharge?.bookings as unknown as {
    renter_id: string;
    owner_id: string;
    cars: {
      brand: string;
      model: string;
      owner: { stripe_connect_account_id: string | null; stripe_connect_onboarded: boolean } | null;
    } | null;
  } | null;

  if (!extraCharge || !booking || booking.renter_id !== user.id) {
    return { error: "Nie masz dostępu do tego zgłoszenia." };
  }
  if (extraCharge.status !== "requested") {
    return { error: "Ta dopłata została już opłacona lub anulowana." };
  }
  if (!booking.cars?.owner?.stripe_connect_account_id || !booking.cars.owner.stripe_connect_onboarded) {
    return { error: "Konfiguracja wypłat właściciela nie jest jeszcze ukończona." };
  }

  // This action deliberately re-creates the session on every click, so the
  // one it replaces has to be killed — otherwise both stay payable and the
  // renter can be charged twice for the same damage claim.
  const admin = createAdminClient();

  const previousCharge = await settlePreviousSession(extraCharge.stripe_checkout_session_id);
  if (previousCharge.kind === "blocked") {
    return { error: previousCharge.error };
  }
  if (previousCharge.kind === "paid") {
    // Paid but never recorded (lost webhook). Unlike an extension, nothing
    // here depends on availability, so just record it — no reason to make
    // the renter pay twice or the owner chase money they already have.
    const { data: healedCharge } = await admin
      .from("booking_extra_charges")
      .update({ status: "paid", stripe_checkout_session_id: previousCharge.sessionId })
      .eq("id", extraChargeId)
      .eq("status", "requested")
      .select("id")
      .single();
    if (healedCharge) {
      await notifyUser({
        userId: booking.owner_id,
        type: "extra_charge_requested",
        subject: `Dopłata opłacona: ${booking.cars.brand} ${booking.cars.model}`,
        body: `Najemca opłacił dodatkową opłatę ${Number(extraCharge.amount_pln).toFixed(2)} zł.`,
        emailHtml: `
          <p>Najemca opłacił zgłoszoną przez Ciebie dodatkową opłatę na GoMambo.</p>
          <p><strong>Kwota:</strong> ${Number(extraCharge.amount_pln).toFixed(2)} zł</p>
          <p><a href="${SITE_URL}/dashboard/bookings">Zobacz rezerwacje →</a></p>
        `,
        link: "/dashboard/bookings",
      });
    }
    return {
      error: "Ta dopłata została już opłacona — właśnie ją zaksięgowaliśmy. Odśwież stronę.",
    };
  }

  const checkoutResult = await createExtraChargeCheckoutSession({
    bookingId: extraCharge.booking_id,
    extraChargeId: extraCharge.id,
    ownerStripeAccountId: booking.cars.owner.stripe_connect_account_id,
    amountPln: Number(extraCharge.amount_pln),
    description: `Dodatkowa opłata: ${booking.cars.brand} ${booking.cars.model}`,
    renterEmail: user.email ?? "",
    successUrl: `${SITE_URL}/dashboard/rentals?extra_charge=success`,
    cancelUrl: `${SITE_URL}/dashboard/rentals?extra_charge=cancelled`,
  });
  if (!checkoutResult.ok) {
    return { error: checkoutResult.error };
  }

  await admin
    .from("booking_extra_charges")
    .update({ stripe_checkout_session_id: checkoutResult.data.sessionId })
    .eq("id", extraChargeId);

  redirect(checkoutResult.data.url);
}
