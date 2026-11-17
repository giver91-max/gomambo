import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPOSIT_ADMIN_STATES } from "@/lib/deposit";

export type AdminQueueCounts = {
  pendingCars: number;
  pendingVerifications: number;
  pendingTransfers: number;
  openReports: number;
  openVerifications: number;
  pendingPartners: number;
  depositCases: number;
};

/**
 * How much is waiting in each admin queue, counted from the queues themselves
 * (rows by status), never from notification read markers.
 *
 * Shared by the nav badges (layout) and the "Do sprawdzenia" list on /admin,
 * which used to be built from UNREAD notifications: opening the bell marked
 * everything read and the list said "Nic nie czeka" next to fifteen pending
 * verifications, while decided ones lingered in it. cache() makes the layout
 * and the page share one set of queries per request.
 *
 * bookings, booking_extra_charges and the other money tables have no admin
 * RLS policy — only the two participants can read a row — so they are counted
 * with the service role. Callers render nothing from this before the layout's
 * role check has let an admin through.
 */
export const getAdminQueueCounts = cache(async (): Promise<AdminQueueCounts> => {
  const supabase = await createClient();
  const admin = createAdminClient();
  const [
    { count: pendingCars },
    { count: pendingVerifications },
    { count: pendingBookingTransfers },
    { count: pendingChargeTransfers },
    { count: openReports },
    { count: openVerifications },
    { count: pendingPartners },
    { count: depositCases },
  ] = await Promise.all([
    supabase.from("cars").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("identity_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("payment_method", "bank_transfer")
      .eq("payment_status", "unpaid")
      .in("status", ["accepted", "completed"]),
    admin
      .from("booking_extra_charges")
      .select("id", { count: "exact", head: true })
      .eq("payment_method", "bank_transfer")
      .eq("status", "requested"),
    admin
      .from("damage_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    admin
      .from("booking_verifications")
      .select("booking_id", { count: "exact", head: true })
      .eq("status", "escalated"),
    admin
      .from("partners")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    // Same filter as the "Do decyzji" view of /admin/kaucje.
    admin
      .from("booking_deposits")
      .select("booking_id", { count: "exact", head: true })
      .or(`status.in.(${DEPOSIT_ADMIN_STATES.join(",")}),refund_status.eq.failed`),
  ]);

  return {
    pendingCars: pendingCars ?? 0,
    pendingVerifications: pendingVerifications ?? 0,
    pendingTransfers: (pendingBookingTransfers ?? 0) + (pendingChargeTransfers ?? 0),
    openReports: openReports ?? 0,
    openVerifications: openVerifications ?? 0,
    pendingPartners: pendingPartners ?? 0,
    depositCases: depositCases ?? 0,
  };
});
