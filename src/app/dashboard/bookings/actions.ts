"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus } from "@/types/database";

export async function updateBookingStatus(
  bookingId: string,
  status: Extract<BookingStatus, "accepted" | "declined">
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select("owner_id")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }

  const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
