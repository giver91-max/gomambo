"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus } from "@/types/database";

export async function updateBookingStatus(
  bookingId: string,
  status: Extract<BookingStatus, "accepted" | "declined" | "completed">
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

export async function cancelBooking(bookingId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select("renter_id, status")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) return;
  if (booking.status !== "requested" && booking.status !== "accepted") return;

  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
}

export async function submitReview(
  bookingId: string,
  rating: number,
  comment: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Wybierz ocenę od 1 do 5." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("owner_id, renter_id, status, car_id")
    .eq("id", bookingId)
    .single();

  if (!booking || (booking.owner_id !== user.id && booking.renter_id !== user.id)) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "completed") {
    return { error: "Można ocenić tylko zakończone wypożyczenie." };
  }

  const revieweeId = booking.owner_id === user.id ? booking.renter_id : booking.owner_id;
  const trimmedComment = comment.trim();

  const { error } = await supabase.from("reviews").insert({
    booking_id: bookingId,
    reviewer_id: user.id,
    reviewee_id: revieweeId,
    rating,
    comment: trimmedComment || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Już oceniłeś to wypożyczenie." };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  revalidatePath(`/auta/${booking.car_id}`);
  return { error: null };
}
