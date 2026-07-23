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

// Shared by the renter's own cancelBooking, the admin override
// (adminCancelBooking), and now the owner's ownerCancelBooking — same
// money-handling rules either way: release any held deposit
// unconditionally (nothing left to hold once the trip is off), refund the
// rental fee only if still inside the free-cancellation window — UNLESS
// forceFullRefund is set. That window exists to protect the OWNER from a
// late renter-initiated cancellation; it has no meaning when the OWNER is
// the one cancelling an already-confirmed booking, so that path always
// passes forceFullRefund: true instead.
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
): Promise<void> {
  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  if (booking.deposit_status === "held" && booking.stripe_deposit_payment_intent_id) {
    const releaseResult = await releaseDeposit(booking.stripe_deposit_payment_intent_id);
    if (releaseResult.ok) {
      await supabase.from("bookings").update({ deposit_status: "released" }).eq("id", bookingId);
    }
  }

  if (booking.payment_status === "paid" && booking.stripe_checkout_session_id) {
    if (
      options.forceFullRefund ||
      isWithinFreeCancellationWindow(booking.cancellation_policy, booking.start_date)
    ) {
      const refundResult = await refundCheckoutSession(booking.stripe_checkout_session_id);
      if (refundResult.ok) {
        await supabase.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
      }
    }
  }
}
