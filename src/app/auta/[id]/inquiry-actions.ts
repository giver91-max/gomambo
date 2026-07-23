"use server";

import { createClient } from "@/lib/supabase/server";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { getVerificationStatus } from "@/lib/verification-gate";
import { hasOverlappingBooking } from "@/lib/booking-availability";
import { notifyUser } from "@/lib/notify-user";

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
  if (!(await verifyRecaptcha(recaptchaToken, "inquiry"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const { data: car } = await supabase
    .from("cars")
    .select("brand, model, year, city, owner_id")
    .eq("id", carId)
    .eq("status", "approved")
    .single();

  if (!car) {
    return { error: "Nie znaleziono ogłoszenia." };
  }
  if (car.owner_id === user.id) {
    return { error: "Nie możesz wysłać zapytania o własne auto." };
  }

  // Instant book: every renter reaching this point is already identity
  // verified (checked above), so there's no more-cautious subset left to
  // gate on — every request auto-confirms. That removes the owner's only
  // review step before now, so the one thing standing between two renters
  // landing on the same car is this overlap check.
  if (await hasOverlappingBooking(carId, rangeStart, rangeEnd)) {
    return { error: "Te daty są już zarezerwowane. Wybierz inny termin." };
  }

  const { error: bookingError } = await supabase.from("bookings").insert({
    car_id: carId,
    owner_id: car.owner_id,
    renter_id: user.id,
    start_date: rangeStart,
    end_date: rangeEnd,
    status: "accepted",
  });
  if (bookingError) {
    return { error: bookingError.message };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .upsert(
      { car_id: carId, owner_id: car.owner_id, renter_id: user.id },
      { onConflict: "car_id,renter_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();
  if (conversationError || !conversation) {
    return { error: conversationError?.message ?? "Nie udało się utworzyć wątku wiadomości." };
  }

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender_id: user.id,
    body: `Zapytanie o wynajem (${rangeStart} – ${rangeEnd}):\n\n${message}`,
  });
  if (messageError) {
    return { error: messageError.message };
  }

  await notifyUser({
    userId: car.owner_id,
    type: "booking_confirmed",
    subject: `Nowa rezerwacja: ${car.brand} ${car.model}`,
    body: `${car.brand} ${car.model} (${car.year}), ${car.city} — rezerwacja na ${rangeStart} – ${rangeEnd} została automatycznie potwierdzona.`,
    emailHtml: `
      <p>Masz nową, automatycznie potwierdzoną rezerwację na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${car.brand} ${car.model} (${car.year}), ${car.city}</li>
        <li><strong>Termin:</strong> ${rangeStart} – ${rangeEnd}</li>
      </ul>
      <p><strong>Wiadomość od najemcy:</strong></p>
      <p>${message.replace(/\n/g, "<br>")}</p>
      <p>Odpowiedz w skrzynce wiadomości na GoMambo.</p>
    `,
    link: "/dashboard/bookings",
  });

  return { error: null, success: true };
}
