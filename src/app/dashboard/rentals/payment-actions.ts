"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateBookingPrice } from "@/lib/pricing";
import { hasOverlappingBooking } from "@/lib/booking-availability";
import { addDays, toISODate } from "@/lib/calendar";
import {
  calculatePlatformFee,
  createDepositCheckoutSession,
  createExtraChargeCheckoutSession,
  createRentalCheckoutSession,
} from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";

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
      `id, renter_id, status, payment_status, start_date, end_date,
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

  const { total } = calculateBookingPrice(
    Number(car.price_per_day),
    car.price_per_month !== null ? Number(car.price_per_month) : null,
    booking.start_date,
    booking.end_date
  );
  const platformFee = calculatePlatformFee(total);
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
    totalPricePln: total,
    platformFeePln: platformFee,
    description: `Wynajem: ${car.brand} ${car.model}`,
    renterEmail,
    successUrl: depositUrl ?? finalSuccessUrl,
    cancelUrl,
  });
  if (!rentalResult.ok) {
    return { error: rentalResult.error };
  }

  // Uses the admin client only for this one write: total_price/deposit
  // fields aren't user-editable anywhere, so there's no RLS reason to
  // route it through the session client, and it keeps this action
  // consistent with the rest of the money-writing code paths.
  const admin = createAdminClient();
  await admin
    .from("bookings")
    .update({
      total_price: total,
      platform_fee_amount: platformFee,
      stripe_checkout_session_id: rentalResult.data.sessionId,
      ...(depositAmount && depositAmount > 0 ? { deposit_amount: depositAmount } : {}),
    })
    .eq("id", bookingId);

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
      `id, car_id, renter_id, status, payment_status, start_date, end_date, total_price,
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
  if (await hasOverlappingBooking(supabase, booking.car_id, deltaStart, newEndDate, bookingId)) {
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

  const { total: newTotal } = calculateBookingPrice(
    Number(car.price_per_day),
    car.price_per_month !== null ? Number(car.price_per_month) : null,
    booking.start_date,
    newEndDate
  );
  const additionalAmount = Math.round((newTotal - Number(booking.total_price)) * 100) / 100;
  if (additionalAmount <= 0) {
    return { error: "Nie udało się wyliczyć dopłaty za przedłużenie." };
  }

  const admin = createAdminClient();
  const { data: extension, error: extensionError } = await admin
    .from("booking_extensions")
    .insert({ booking_id: bookingId, new_end_date: newEndDate, additional_amount_pln: additionalAmount })
    .select("id")
    .single();
  if (extensionError || !extension) {
    return { error: extensionError?.message ?? "Nie udało się utworzyć prośby o przedłużenie." };
  }

  const platformFee = calculatePlatformFee(additionalAmount);
  const successUrl = `${SITE_URL}/dashboard/rentals?extension=success`;
  const cancelUrl = `${SITE_URL}/dashboard/rentals?extension=cancelled`;

  const checkoutResult = await createRentalCheckoutSession({
    bookingId,
    ownerStripeAccountId: car.owner.stripe_connect_account_id,
    totalPricePln: additionalAmount,
    platformFeePln: platformFee,
    description: `Przedłużenie wynajmu: ${car.brand} ${car.model}`,
    renterEmail: user.email ?? "",
    successUrl,
    cancelUrl,
    metadata: { kind: "trip_extension", extensionId: extension.id },
  });
  if (!checkoutResult.ok) {
    return { error: checkoutResult.error };
  }

  await admin
    .from("booking_extensions")
    .update({ stripe_checkout_session_id: checkoutResult.data.sessionId })
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
      `id, booking_id, amount_pln, reason, status,
       bookings(renter_id,
         cars(brand, model, owner:profiles!cars_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded)))`
    )
    .eq("id", extraChargeId)
    .single();

  const booking = extraCharge?.bookings as unknown as {
    renter_id: string;
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

  const admin = createAdminClient();
  await admin
    .from("booking_extra_charges")
    .update({ stripe_checkout_session_id: checkoutResult.data.sessionId })
    .eq("id", extraChargeId);

  redirect(checkoutResult.data.url);
}
