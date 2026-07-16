"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";
import { isWithinFreeCancellationWindow } from "@/lib/cancellation";
import { captureDeposit, refundCheckoutSession, releaseDeposit } from "@/lib/stripe";
import type { BookingStatus, CancellationPolicy } from "@/types/database";

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
    .select(
      "owner_id, renter_id, start_date, end_date, deposit_status, stripe_deposit_payment_intent_id, cars(brand, model, year)"
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }

  const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
  if (error) {
    return { error: error.message };
  }

  // Trip is over — release the deposit hold unless the owner already
  // captured part of it for damage via captureDepositForDamage below
  // (which flips deposit_status to "captured" before this ever runs).
  if (status === "completed" && booking.deposit_status === "held" && booking.stripe_deposit_payment_intent_id) {
    const releaseResult = await releaseDeposit(booking.stripe_deposit_payment_intent_id);
    if (releaseResult.ok) {
      await supabase.from("bookings").update({ deposit_status: "released" }).eq("id", bookingId);
    }
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
    .select(
      `renter_id, owner_id, status, start_date, end_date,
       payment_status, stripe_checkout_session_id, deposit_status, stripe_deposit_payment_intent_id,
       cars(brand, model, year, cancellation_policy)`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) return;
  if (booking.status !== "requested" && booking.status !== "accepted") return;

  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

  // Nothing to hold a deposit against once the trip is off, regardless of
  // whether the rental fee itself gets refunded below.
  if (booking.deposit_status === "held" && booking.stripe_deposit_payment_intent_id) {
    const releaseResult = await releaseDeposit(booking.stripe_deposit_payment_intent_id);
    if (releaseResult.ok) {
      await supabase.from("bookings").update({ deposit_status: "released" }).eq("id", bookingId);
    }
  }

  if (booking.payment_status === "paid" && booking.stripe_checkout_session_id) {
    const policy: CancellationPolicy =
      (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
        ?.cancellation_policy ?? "moderate";
    if (isWithinFreeCancellationWindow(policy, booking.start_date)) {
      const refundResult = await refundCheckoutSession(booking.stripe_checkout_session_id);
      if (refundResult.ok) {
        await supabase.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
      }
    }
  }

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

// The only "damage claim" this app supports for now: the owner captures
// some or all of an already-held deposit before marking the booking
// completed (which would otherwise auto-release it), pointing to the
// pickup/return photos and odometer/fuel readings as evidence. A full
// dispute workflow is a deliberate non-goal for v1 — see the Stripe plan.
export async function captureDepositForDamage(
  bookingId: string,
  amountPln: number,
  reason: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(amountPln > 0)) {
    return { error: "Podaj kwotę większą od zera." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "owner_id, renter_id, deposit_status, deposit_amount, stripe_deposit_payment_intent_id, cars(brand, model, year)"
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.deposit_status !== "held" || !booking.stripe_deposit_payment_intent_id) {
    return { error: "Brak zablokowanej kaucji do zatrzymania." };
  }
  if (booking.deposit_amount !== null && amountPln > Number(booking.deposit_amount)) {
    return { error: "Kwota przekracza wysokość kaucji." };
  }

  const captureResult = await captureDeposit(booking.stripe_deposit_payment_intent_id, amountPln);
  if (!captureResult.ok) {
    return { error: captureResult.error };
  }

  await supabase.from("bookings").update({ deposit_status: "captured" }).eq("id", bookingId);

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  const trimmedReason = reason.trim();
  await notifyUser({
    userId: booking.renter_id,
    type: "deposit_captured",
    subject: `Kaucja zatrzymana: ${carLabel}`,
    body: `Właściciel zatrzymał ${amountPln.toFixed(2)} zł kaucji za ${carLabel}.${
      trimmedReason ? ` Powód: ${trimmedReason}` : ""
    }`,
    emailHtml: `
      <p>Właściciel zatrzymał część kaucji za wynajem na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabel}</li>
        <li><strong>Kwota:</strong> ${amountPln.toFixed(2)} zł</li>
        ${trimmedReason ? `<li><strong>Powód:</strong> ${trimmedReason}</li>` : ""}
      </ul>
      <p>Jeśli się z tym nie zgadzasz, napisz do nas przez czat.</p>
      <p><a href="https://www.gomambo.pl/dashboard/rentals">Zobacz rezerwacje →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
