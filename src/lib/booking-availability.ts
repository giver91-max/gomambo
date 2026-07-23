import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Instant book (sendInquiry) and trip extensions both auto-confirm without
// an owner review step in between, so this is the one guard standing
// between two renters landing on the same car for overlapping dates.
// Checked against `bookings` (accepted/completed only), not
// `car_availability` — that table is just the owner's allow-list of which
// days are open for a NEW request, it says nothing about which days are
// already spoken for by an existing booking.
export async function hasOverlappingBooking(
  supabase: SupabaseClient<Database>,
  carId: string,
  startDate: string,
  endDate: string,
  excludeBookingId?: string
): Promise<boolean> {
  let query = supabase
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
