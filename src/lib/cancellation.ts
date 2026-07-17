import type { SupabaseClient } from "@supabase/supabase-js";
import { CANCELLATION_POLICY_FREE_HOURS } from "@/lib/car-options";
import { refundCheckoutSession, releaseDeposit } from "@/lib/stripe";
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

// Shared by the renter's own cancelBooking and the admin override
// (adminCancelBooking) — same money-handling rules either way: release any
// held deposit unconditionally (nothing left to hold once the trip is off),
// refund the rental fee only if still inside the free-cancellation window.
// No separate "force refund regardless of window" tool exists yet for
// disputes — a known, deliberate gap, not solved here.
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
  }
): Promise<void> {
  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  if (booking.deposit_status === "held" && booking.stripe_deposit_payment_intent_id) {
    const releaseResult = await releaseDeposit(booking.stripe_deposit_payment_intent_id);
    if (releaseResult.ok) {
      await supabase.from("bookings").update({ deposit_status: "released" }).eq("id", bookingId);
    }
  }

  if (booking.payment_status === "paid" && booking.stripe_checkout_session_id) {
    if (isWithinFreeCancellationWindow(booking.cancellation_policy, booking.start_date)) {
      const refundResult = await refundCheckoutSession(booking.stripe_checkout_session_id);
      if (refundResult.ok) {
        await supabase.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
      }
    }
  }
}
