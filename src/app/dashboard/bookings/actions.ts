"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";
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
    .select("owner_id, renter_id, start_date, end_date, cars(brand, model, year)")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }

  const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
  if (error) {
    return { error: error.message };
  }

  if (status === "accepted" || status === "declined") {
    const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
    const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
    await notifyUser({
      userId: booking.renter_id,
      type: status === "accepted" ? "booking_accepted" : "booking_declined",
      subject:
        status === "accepted"
          ? `Rezerwacja zaakceptowana: ${carLabel}`
          : `Rezerwacja odrzucona: ${carLabel}`,
      body:
        status === "accepted"
          ? `Właściciel zaakceptował Twoje zapytanie o ${carLabel} (${booking.start_date} – ${booking.end_date}).`
          : `Właściciel odrzucił Twoje zapytanie o ${carLabel} (${booking.start_date} – ${booking.end_date}).`,
      emailHtml:
        status === "accepted"
          ? `
            <p>Właściciel zaakceptował Twoje zapytanie o wynajem na GoMambo.</p>
            <ul>
              <li><strong>Auto:</strong> ${carLabel}</li>
              <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
            </ul>
            <p><a href="https://www.gomambo.pl/dashboard/rentals">Zobacz szczegóły →</a></p>
          `
          : `
            <p>Właściciel odrzucił Twoje zapytanie o wynajem na GoMambo.</p>
            <ul>
              <li><strong>Auto:</strong> ${carLabel}</li>
              <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
            </ul>
            <p>Przejrzyj inne dostępne auta w Twojej okolicy.</p>
            <p><a href="https://www.gomambo.pl/auta">Przeglądaj auta →</a></p>
          `,
      link: "/dashboard/rentals",
    });
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
    .select("renter_id, owner_id, status, start_date, end_date, cars(brand, model, year)")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) return;
  if (booking.status !== "requested" && booking.status !== "accepted") return;

  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  await notifyUser({
    userId: booking.owner_id,
    type: "booking_cancelled",
    subject: `Rezerwacja anulowana: ${carLabel}`,
    body: `Najemca anulował rezerwację ${carLabel} (${booking.start_date} – ${booking.end_date}).`,
    emailHtml: `
      <p>Najemca anulował rezerwację na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabel}</li>
        <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
      </ul>
      <p><a href="https://www.gomambo.pl/dashboard/bookings">Zobacz rezerwacje →</a></p>
    `,
    link: "/dashboard/bookings",
  });

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
