import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { notifyUser } from "@/lib/notify-user";
import { SITE_URL } from "@/lib/site";
import { addDays, toISODate } from "@/lib/calendar";
import { sendNotificationEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";

const ADMIN_ALERT_EMAIL = "user@gomambo.pl";

export type BookingVerificationStatus =
  | "pending_renter"
  | "pending_owner"
  | "approved"
  | "escalated";

/**
 * Opens the pre-rental re-verification for one booking and tells the renter.
 * Idempotent: the row is keyed on booking_id, so a second call (the cron
 * running again, or a booking made minutes before it fires) changes nothing.
 *
 * Returns true only when THIS call created the row, so the caller can avoid
 * notifying the renter twice.
 */
export async function requestBookingVerification(
  admin: SupabaseClient<Database>,
  booking: {
    id: string;
    renter_id: string;
    start_date: string;
    carLabel: string;
  }
): Promise<boolean> {
  const { data: created } = await admin
    .from("booking_verifications")
    .insert({ booking_id: booking.id, status: "pending_renter" })
    .select("booking_id")
    .maybeSingle();

  if (!created) return false;

  await notifyUser({
    userId: booking.renter_id,
    type: "booking_verification_requested",
    subject: `Potwierdź tożsamość przed odbiorem: ${booking.carLabel}`,
    body: `Przed wynajmem ${booking.carLabel} (${booking.start_date}) zrób krótkie selfie — porównamy je z dokumentem, który już zweryfikowaliśmy. Bez tego nie wyślemy Ci danych do odbioru.`,
    emailHtml: `
      <p>Twój wynajem zbliża się, więc prosimy o ostatni krok.</p>
      <p><strong>Zrób selfie w aplikacji</strong> — porównamy je automatycznie z dokumentem, który już od Ciebie mamy. Zajmuje to kilkanaście sekund i robi się raz na wynajem.</p>
      <p>Robimy to, bo auto wydaje Ci prywatna osoba albo lokalna wypożyczalnia i musi mieć pewność, że odbiera je ta sama osoba, która rezerwowała. Dopóki tego nie zrobisz, nie wyślemy Ci numeru rejestracyjnego ani kontaktu do właściciela.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Potwierdź tożsamość →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  return true;
}

/**
 * How many days before the trip the renter is asked. Rafał's decision.
 * A booking made later than this is asked immediately instead — those are
 * statistically the riskiest, so they must not be the ones that skip the
 * check entirely.
 */
export const VERIFICATION_LEAD_DAYS = 2;

/**
 * Puts a case on GoMambo's desk: the internal reason goes to a table only an
 * admin can read, never onto the shared verification row.
 */
export async function raiseToGoMambo(
  admin: SupabaseClient<Database>,
  bookingId: string,
  carLabel: string,
  reason: string
): Promise<void> {
  const { error: noteError } = await admin
    .from("booking_verification_notes")
    .upsert({ booking_id: bookingId, reason });
  if (noteError) {
    console.error("[booking-verification] note upsert failed", noteError);
  }

  const { error } = await admin.from("admin_notifications").insert({
    type: "booking_verification_escalated",
    body: `Weryfikacja przed wynajmem ${carLabel} wymaga Twojej decyzji. Rezerwacja ${bookingId}.`,
    link: "/admin/weryfikacje-najmu",
  });
  if (error) {
    console.error("[booking-verification] admin notification insert failed", error);
  }

  await sendNotificationEmail({
    to: ADMIN_ALERT_EMAIL,
    subject: `Weryfikacja przed wynajmem do decyzji: ${carLabel}`,
    html: `
      <p>Weryfikacja przed wynajmem wymaga Twojej decyzji.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
        <li><strong>Rezerwacja:</strong> ${bookingId}</li>
      </ul>
      <p>${escapeHtml(reason)}</p>
      <p><a href="${SITE_URL}/admin/weryfikacje-najmu">Rozstrzygnij →</a></p>
    `,
  });
}

/**
 * Called wherever a booking becomes paid. The daily cron opens verifications
 * for trips starting within the lead window, but a same-day booking paid
 * after that run would never get one at all — and those are the riskiest.
 * Idempotent, so calling it alongside the cron is harmless.
 */
export async function requestVerificationIfDue(
  admin: SupabaseClient<Database>,
  bookingId: string
): Promise<void> {
  const { data: booking } = await admin
    .from("bookings")
    .select("id, renter_id, start_date, status, payment_status, cars(brand, model, year)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return;
  if (booking.status !== "accepted" || booking.payment_status !== "paid") return;

  const leadDate = toISODate(addDays(new Date(), VERIFICATION_LEAD_DAYS));
  if (booking.start_date > leadDate) return;

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  await requestBookingVerification(admin, {
    id: booking.id,
    renter_id: booking.renter_id,
    start_date: booking.start_date,
    carLabel: car ? `${car.brand} ${car.model} (${car.year})` : "auto",
  });
}
