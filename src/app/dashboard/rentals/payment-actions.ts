"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateBookingPrice } from "@/lib/pricing";
import {
  calculatePlatformFee,
  createDepositCheckoutSession,
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
