import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// A conversation stays open for messaging only while the underlying rental
// is unresolved — from the initial request through the active rental, and
// indefinitely if it's never marked completed (e.g. a dispute like an
// accident or theft). It closes once every booking for that car+renter pair
// is declined, cancelled, or completed.
export async function isConversationActive(
  supabase: SupabaseClient<Database>,
  carId: string,
  renterId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("bookings")
    .select("id")
    .eq("car_id", carId)
    .eq("renter_id", renterId)
    .in("status", ["requested", "accepted"])
    .limit(1);

  return (data ?? []).length > 0;
}
