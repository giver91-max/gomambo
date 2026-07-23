"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { cancelBookingWithRefund } from "@/lib/cancellation";
import { captureDeposit, createExtraChargeCheckoutSession, releaseDeposit } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";
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

  const policy: CancellationPolicy =
    (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
      ?.cancellation_policy ?? "moderate";
  await cancelBookingWithRefund(supabase, bookingId, {
    start_date: booking.start_date,
    payment_status: booking.payment_status,
    stripe_checkout_session_id: booking.stripe_checkout_session_id,
    deposit_status: booking.deposit_status,
    stripe_deposit_payment_intent_id: booking.stripe_deposit_payment_intent_id,
    cancellation_policy: policy,
  });

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

// Instant book removed the owner's one point of control (manually
// declining before accepting) — this is the replacement: an owner can
// still back out of an already-confirmed booking, but only before the
// trip starts, and always with a full refund (forceFullRefund: true).
// The free-cancellation window exists to protect the owner from a late
// renter cancellation; it has no bearing on the owner cancelling on the
// renter, so it's never applied here.
export async function ownerCancelBooking(bookingId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `owner_id, renter_id, status, start_date, end_date,
       payment_status, stripe_checkout_session_id, deposit_status, stripe_deposit_payment_intent_id,
       cars(brand, model, year, cancellation_policy)`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted") {
    return { error: "Można odwołać tylko potwierdzoną rezerwację." };
  }
  if (booking.start_date <= new Date().toISOString().slice(0, 10)) {
    return { error: "Nie można odwołać rezerwacji, która już się rozpoczęła." };
  }

  const policy: CancellationPolicy =
    (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
      ?.cancellation_policy ?? "moderate";
  await cancelBookingWithRefund(
    supabase,
    bookingId,
    {
      start_date: booking.start_date,
      payment_status: booking.payment_status,
      stripe_checkout_session_id: booking.stripe_checkout_session_id,
      deposit_status: booking.deposit_status,
      stripe_deposit_payment_intent_id: booking.stripe_deposit_payment_intent_id,
      cancellation_policy: policy,
    },
    { forceFullRefund: true }
  );

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  await notifyUser({
    userId: booking.renter_id,
    type: "booking_cancelled",
    subject: `Rezerwacja odwołana: ${carLabel}`,
    body: `Właściciel odwołał rezerwację ${carLabel} (${booking.start_date} – ${booking.end_date}). Otrzymasz pełny zwrot.`,
    emailHtml: `
      <p>Właściciel odwołał Twoją rezerwację na GoMambo. Otrzymasz pełny zwrot.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabel}</li>
        <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
      </ul>
      <p><a href="https://www.gomambo.pl/auta">Przeglądaj inne auta →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
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

// Damage above the held deposit — can never be an automatic card charge
// (no saved Stripe Customer/PaymentMethod exists, and BLIK — Poland's
// dominant payment method — can't support one anyway), so this creates a
// fresh Checkout Session the renter must pay themselves. No platform fee:
// this is compensation for the owner's loss, not a rental fee.
export async function requestExtraCharge(
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
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "Podaj powód dodatkowej opłaty." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      `owner_id, renter_id, status,
       cars(brand, model, owner:profiles!cars_owner_id_fkey(stripe_connect_account_id, stripe_connect_onboarded))`
    )
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted" && booking.status !== "completed") {
    return { error: "Można zgłosić dopłatę tylko dla potwierdzonego lub zakończonego wynajmu." };
  }

  const car = booking.cars as unknown as {
    brand: string;
    model: string;
    owner: { stripe_connect_account_id: string | null; stripe_connect_onboarded: boolean } | null;
  } | null;
  if (!car?.owner?.stripe_connect_account_id || !car.owner.stripe_connect_onboarded) {
    return { error: "Konfiguracja wypłat nie jest jeszcze ukończona." };
  }

  const admin = createAdminClient();
  const { data: renterAuth } = await admin.auth.admin.getUserById(booking.renter_id);
  const renterEmail = renterAuth?.user?.email ?? "";

  const { data: extraCharge, error: insertError } = await admin
    .from("booking_extra_charges")
    .insert({ booking_id: bookingId, amount_pln: amountPln, reason: trimmedReason })
    .select("id")
    .single();
  if (insertError || !extraCharge) {
    return { error: insertError?.message ?? "Nie udało się zapisać zgłoszenia." };
  }

  const checkoutResult = await createExtraChargeCheckoutSession({
    bookingId,
    extraChargeId: extraCharge.id,
    ownerStripeAccountId: car.owner.stripe_connect_account_id,
    amountPln,
    description: `Dodatkowa opłata: ${car.brand} ${car.model}`,
    renterEmail,
    successUrl: `${SITE_URL}/dashboard/rentals?extra_charge=success`,
    cancelUrl: `${SITE_URL}/dashboard/rentals?extra_charge=cancelled`,
  });
  if (!checkoutResult.ok) {
    return { error: checkoutResult.error };
  }

  await admin
    .from("booking_extra_charges")
    .update({ stripe_checkout_session_id: checkoutResult.data.sessionId })
    .eq("id", extraCharge.id);

  const carLabel = `${car.brand} ${car.model}`;
  await notifyUser({
    userId: booking.renter_id,
    type: "extra_charge_requested",
    subject: `Prośba o dopłatę: ${carLabel}`,
    body: `Właściciel prosi o dopłatę ${amountPln.toFixed(2)} zł za ${carLabel}. Powód: ${trimmedReason}`,
    emailHtml: `
      <p>Właściciel prosi o dodatkową opłatę za wynajem na GoMambo, ponad kaucję.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabel}</li>
        <li><strong>Kwota:</strong> ${amountPln.toFixed(2)} zł</li>
        <li><strong>Powód:</strong> ${trimmedReason}</li>
      </ul>
      <p>Jeśli się z tym nie zgadzasz, napisz do nas przez czat — decyzję można cofnąć tylko ręcznie.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Zapłać lub zobacz szczegóły →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  return { error: null };
}
