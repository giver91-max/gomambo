import { createAdminClient } from "@/lib/supabase/admin";

// Instant book (sendInquiry) and trip extensions both auto-confirm without
// an owner review step in between, so this is the one guard standing
// between two renters landing on the same car for overlapping dates.
// Checked against `bookings` (accepted/completed only), not
// `car_availability` — that table is just the owner's allow-list of which
// days are open for a NEW request, it says nothing about which days are
// already spoken for by an existing booking.
//
// Deliberately always uses the admin client rather than accepting the
// caller's session-scoped one: this check must see every booking on the
// car regardless of who made it, but RLS on `bookings` restricts SELECT
// to rows where the querying user is a participant — with the session
// client, a renter's query would silently see 0 rows for another renter's
// booking on the same car and let a real double-booking straight through.
export async function hasOverlappingBooking(
  carId: string,
  startDate: string,
  endDate: string,
  excludeBookingId?: string
): Promise<boolean> {
  const admin = createAdminClient();
  let query = admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("car_id", carId)
    .in("status", ["accepted", "completed"])
    .lte("start_date", endDate)
    .gte("end_date", startDate);

  if (excludeBookingId) {
    query = query.neq("id", excludeBookingId);
  }

  const { count, error } = await query;
  if (error) {
    console.error("hasOverlappingBooking:", error);
    // Fail closed — an unreadable overlap check must never let a booking
    // through as if the dates were clear.
    return true;
  }
  return (count ?? 0) > 0;
}
