"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCommission, calculateBookingPrice } from "@/lib/pricing";
import { getOwnerCommissionRate } from "@/lib/commission";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { getVerificationStatus } from "@/lib/verification-gate";
import { hasOverlappingBooking } from "@/lib/booking-availability";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";

export type InquiryState = { error: string | null; success?: boolean };

export async function sendInquiry(
  _prevState: InquiryState,
  formData: FormData
): Promise<InquiryState> {
  // Honeypot: real users never fill a field named "website" that isn't shown.
  if (String(formData.get("website") ?? "")) {
    return { error: null, success: true };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Zaloguj się, aby wysłać zapytanie o wynajem." };
  }

  const { status: verificationStatus } = await getVerificationStatus(supabase, user.id);
  if (verificationStatus !== "approved") {
    return { error: "Musisz najpierw zweryfikować tożsamość i prawo jazdy, zanim wyślesz zapytanie." };
  }

  const carId = String(formData.get("carId") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const rangeStart = String(formData.get("rangeStart") ?? "").trim();
  const rangeEnd = String(formData.get("rangeEnd") ?? "").trim();
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!carId || !message || !rangeStart || !rangeEnd) {
    return { error: "Wybierz termin i napisz wiadomość." };
  }
  // Enforced server-side too: the renter is taking on full liability for the
  // car, so a client-side `required` alone would be too easy to bypass.
  if (formData.get("insuranceAck") !== "on") {
    return {
      error:
        "Potwierdź, że rozumiesz zasady odpowiedzialności za auto wynajmowane bez dodatkowego ubezpieczenia.",
    };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "inquiry"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const { data: car } = await supabase
    .from("cars")
    .select(
      "brand, model, year, city, owner_id, price_per_day, price_per_month, instant_book, partner_id"
    )
    .eq("id", carId)
    .eq("status", "approved")
    .single();

  if (!car) {
    return { error: "Nie znaleziono ogłoszenia." };
  }
  if (car.owner_id === user.id) {
    return { error: "Nie możesz wysłać zapytania o własne auto." };
  }

  // Instant book for peer-to-peer listings: the renter is already identity
  // verified, so there is no more-cautious subset left to gate on. A Partner
  // car is different — a rental company runs its own fleet calendar and will
  // not accept an auto-confirmed booking on a car that may be in service, so
  // those land as 'requested' and wait for the Partner. Either way this
  // overlap check is the only thing standing between two renters and the
  // same car.
  if (await hasOverlappingBooking(carId, rangeStart, rangeEnd)) {
    return { error: "Te daty są już zarezerwowane. Wybierz inny termin." };
  }

  // The price the renter just agreed to is locked onto the booking now.
  // Recomputing it at payment time would let an owner raise price_per_day in
  // the meantime and charge a confirmed renter the new rate — and the renter
  // would never see it, because the breakdown they accepted lived only in
  // the form. Written with the service role: money columns are pinned
  // against session writes (migration 0036).
  const { total: rentalTotal } = calculateBookingPrice(
    Number(car.price_per_day),
    car.price_per_month !== null ? Number(car.price_per_month) : null,
    rangeStart,
    rangeEnd
  );
  const { commission, gross } = applyCommission(
    rentalTotal,
    await getOwnerCommissionRate(car.owner_id)
  );

  // The message thread FIRST, and the booking only once it exists.
  //
  // The other order left a booking behind whenever this step failed: it is
  // written with the service role, so nothing rolls it back, and the renter
  // saw a raw Postgres error while a real booking silently blocked those
  // dates — on an instant-book car, blocking the renter's own retry.
  //
  // And it did fail, every second time. conversations has SELECT and INSERT
  // policies and no UPDATE one, while upsert(ignoreDuplicates: false) sends
  // ON CONFLICT DO UPDATE, which RLS then denies. Same reason
  // getOrCreateAdminConversation in lib/admin-chat.ts is written this way:
  // find the row, insert it if missing, and re-select if a concurrent
  // request won the race.
  const conversationId = await getOrCreateConversation(
    supabase,
    carId,
    car.owner_id,
    user.id
  );
  if (!conversationId) {
    return { error: "Nie udało się utworzyć wątku wiadomości. Spróbuj ponownie." };
  }

  const { error: bookingError } = await createAdminClient().from("bookings").insert({
    car_id: carId,
    owner_id: car.owner_id,
    renter_id: user.id,
    start_date: rangeStart,
    end_date: rangeEnd,
    status: car.instant_book ? "accepted" : "requested",
    total_price: gross,
    platform_fee_amount: commission,
  });
  if (bookingError) {
    return { error: bookingError.message };
  }

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: `Zapytanie o wynajem (${rangeStart} – ${rangeEnd}):\n\n${message}`,
  });
  if (messageError) {
    return { error: messageError.message };
  }

  // Two different mails, because two different things happened. Telling a
  // Partner their booking "została automatycznie potwierdzona" when it is
  // sitting at 'requested' would be false, and they would never come and
  // confirm it.
  const carLabelHtml = escapeHtml(`${car.brand} ${car.model} (${car.year}), ${car.city}`);
  const messageHtml = escapeHtml(message).replace(/\n/g, "<br>");

  await notifyUser({
    userId: car.owner_id,
    type: "booking_confirmed",
    subject: car.instant_book
      ? `Nowa rezerwacja: ${car.brand} ${car.model}`
      : `Do potwierdzenia: ${car.brand} ${car.model}`,
    body: car.instant_book
      ? `${car.brand} ${car.model} (${car.year}), ${car.city} — rezerwacja na ${rangeStart} – ${rangeEnd} została automatycznie potwierdzona.`
      : `${car.brand} ${car.model} (${car.year}), ${car.city} — nowa rezerwacja na ${rangeStart} – ${rangeEnd} czeka na Twoje potwierdzenie. Bez niego klient nie zapłaci.`,
    emailHtml: car.instant_book
      ? `
      <p>Masz nową, automatycznie potwierdzoną rezerwację na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabelHtml}</li>
        <li><strong>Termin:</strong> ${rangeStart} – ${rangeEnd}</li>
      </ul>
      <p><strong>Wiadomość od najemcy:</strong></p>
      <p>${messageHtml}</p>
      <p>Odpowiedz w skrzynce wiadomości na GoMambo.</p>
    `
      : `
      <p>Nowa rezerwacja czeka na Twoje potwierdzenie.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabelHtml}</li>
        <li><strong>Termin:</strong> ${rangeStart} – ${rangeEnd}</li>
      </ul>
      <p><strong>Wiadomość od klienta:</strong></p>
      <p>${messageHtml}</p>
      <p>Potwierdź w panelu — dopiero wtedy klient zapłaci. Jeśli auto jest niedostępne, odrzuć rezerwację; klient nie został jeszcze obciążony.</p>
      <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
    `,
    link: "/dashboard/bookings",
  });

  return { error: null, success: true };
}

/**
 * The thread between this renter and this car, created if it is not there.
 *
 * Not an upsert: public.conversations has no UPDATE policy, so the
 * ON CONFLICT DO UPDATE branch that supabase-js emits for
 * upsert(ignoreDuplicates: false) is refused by RLS for every repeat
 * inquiry.
 */
async function getOrCreateConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  carId: string,
  ownerId: string,
  renterId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("car_id", carId)
    .eq("renter_id", renterId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await supabase
    .from("conversations")
    .insert({ car_id: carId, owner_id: ownerId, renter_id: renterId })
    .select("id")
    .maybeSingle();
  if (created) return created.id;

  // A concurrent inquiry won the unique index — read back what it wrote.
  const { data: raced } = await supabase
    .from("conversations")
    .select("id")
    .eq("car_id", carId)
    .eq("renter_id", renterId)
    .maybeSingle();
  return raced?.id ?? null;
}
