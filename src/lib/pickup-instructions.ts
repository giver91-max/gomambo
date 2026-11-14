import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { notifyUser } from "@/lib/notify-user";
import { addDays, toISODate } from "@/lib/calendar";
import { FUEL_POLICY_DESCRIPTIONS, FUEL_POLICY_LABELS } from "@/lib/car-options";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { bookingDepositAmounts, formatZl } from "@/lib/deposit";

/**
 * Everything the renter needs to actually collect the car: the plate, where
 * it is, who to call, and what to bring.
 *
 * Deliberately NOT cron-only. The daily job looks at trips starting today or
 * tomorrow, so a verification approved after it has already run would leave
 * that renter with no plate, no address and no phone number for a trip
 * starting in hours. Both the cron and the approval paths call this; the
 * pickup_instructions_sent_at claim is what keeps it to one send.
 *
 * Returns true only if this call is the one that sent it.
 */
export async function sendPickupInstructionsIfDue(
  admin: SupabaseClient<Database>,
  bookingId: string
): Promise<boolean> {
  const today = toISODate(new Date());
  const tomorrow = toISODate(addDays(new Date(), 1));

  const { data: booking } = await admin
    .from("bookings")
    .select(
      `id, start_date, end_date, renter_id, status, payment_status, pickup_instructions_sent_at,
       deposit_amount, deposit_fee_amount,
       cars(brand, model, year, city, delivery_available, delivery_info,
            mileage_limit_km, fuel_policy, security_deposit_amount,
            car_private(registration_number),
            owner:profiles!cars_owner_id_fkey(full_name, phone))`
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) return false;
  if (booking.status !== "accepted" || booking.payment_status !== "paid") return false;
  if (booking.pickup_instructions_sent_at) return false;
  // Too far out — the daily job will pick it up at the right time.
  if (booking.start_date > tomorrow) return false;
  // Over: nothing useful left to send. A trip that has started but not
  // ended still gets them — a deposit paid on or after pickup day (Rafał:
  // the renter may still pay then, and the owner waits) or a verification
  // GoMambo approved late is exactly when the renter needs them.
  if (booking.end_date < today) return false;

  // Only once the owner (or GoMambo) has confirmed the renter: this mail
  // carries the plate, the owner's phone and where the car is, which is
  // exactly what must not reach an account someone else has taken over.
  const { data: verification } = await admin
    .from("booking_verifications")
    .select("status")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (verification && verification.status !== "approved") return false;

  const car = booking.cars as unknown as {
    brand: string;
    model: string;
    year: number;
    city: string;
    delivery_available: boolean;
    delivery_info: string | null;
    mileage_limit_km: number | null;
    fuel_policy: keyof typeof FUEL_POLICY_LABELS | null;
    security_deposit_amount: number | null;
    car_private: { registration_number: string | null } | null;
    owner: { full_name: string; phone: string | null } | null;
  } | null;
  if (!car) return false;

  // Nor before the deposit is in (Rafał's rule): once the renter has the
  // plate and the owner's phone, nothing makes them pay it. A booking without
  // a deposit is not held back. handleDepositPayment (deposit-service.ts) calls this
  // again the moment the money arrives.
  const deposit = bookingDepositAmounts(
    booking.deposit_amount,
    booking.deposit_fee_amount,
    car.security_deposit_amount
  );
  if (deposit.amount > 0) {
    const { data: depositRow } = await admin
      .from("booking_deposits")
      .select("status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (depositRow?.status !== "paid") return false;
  }

  // Claim BEFORE mailing: if the mail throws, missing this once beats
  // sending it every day until the trip.
  const { data: claimed } = await admin
    .from("bookings")
    .update({ pickup_instructions_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .is("pickup_instructions_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return false;

  const label = `${car.brand} ${car.model} (${car.year})`;
  const plate = car.car_private?.registration_number ?? null;
  const startsToday = booking.start_date === today;
  const started = booking.start_date < today;
  const when = startsToday ? "dziś" : "jutro";
  // Brand, model, delivery note, owner name and plate are all owner-typed,
  // and this mail goes out signed by the GoMambo domain.
  const labelHtml = escapeHtml(label);
  const plateHtml = plate ? escapeHtml(plate) : null;
  const cityHtml = escapeHtml(car.city);
  const deliveryHtml = car.delivery_info ? escapeHtml(car.delivery_info) : null;
  const ownerNameHtml = car.owner?.full_name ? escapeHtml(car.owner.full_name) : "—";
  const ownerPhoneHtml = car.owner?.phone ? escapeHtml(car.owner.phone) : null;

  await notifyUser({
    userId: booking.renter_id,
    type: "booking_confirmed",
    subject: started
      ? `Dane do odbioru auta: ${label}`
      : `${startsToday ? "Dziś" : "Jutro"} odbierasz auto: ${label}`,
    body: started
      ? `Dane do odbioru ${label} (wynajem od ${booking.start_date}) w ${car.city}. Weź prawo jazdy, zrób zdjęcia auta przy odbiorze.`
      : `Odbiór ${label} ${when} (${booking.start_date}) w ${car.city}. Weź prawo jazdy, zrób zdjęcia auta przy odbiorze.`,
    emailHtml: `
      <p>${started ? `Twój wynajem trwa od ${booking.start_date} — oto dane do odbioru auta.` : `Twój wynajem zaczyna się ${when}.`}</p>
      <ul>
        <li><strong>Auto:</strong> ${labelHtml}${plateHtml ? ` — nr rej. ${plateHtml}` : ""}</li>
        <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
        <li><strong>Miejsce:</strong> ${cityHtml}${
          car.delivery_available && deliveryHtml ? ` · dowóz: ${deliveryHtml}` : ""
        }</li>
        <li><strong>Właściciel:</strong> ${ownerNameHtml}${
          ownerPhoneHtml ? ` · tel. ${ownerPhoneHtml}` : ""
        }</li>
      </ul>
      <p><strong>Weź ze sobą:</strong> prawo jazdy — to samo, które przeszło weryfikację.</p>
      <p><strong>Przy odbiorze koniecznie:</strong> zrób zdjęcia auta dookoła i wnętrza oraz spisz stan licznika i paliwa w zakładce „Zdjęcia odbioru i zwrotu”. To jedyny dowód stanu auta, jeśli później pojawi się spór o szkodę.</p>
      ${car.mileage_limit_km ? `<p><strong>Limit kilometrów:</strong> ${car.mileage_limit_km} km/dzień — powyżej limitu właściciel może doliczyć opłatę.</p>` : ""}
      ${car.fuel_policy ? `<p><strong>Paliwo:</strong> ${FUEL_POLICY_LABELS[car.fuel_policy]} — ${FUEL_POLICY_DESCRIPTIONS[car.fuel_policy]}</p>` : ""}
      ${deposit.amount > 0 ? `<p><strong>Kaucja ${formatZl(deposit.amount)} wpłacona</strong> — wróci po zwrocie auta.</p>` : ""}
      <p>Coś nie gra przy odbiorze? Zgłoś to od razu przyciskiem „Zgłoś problem” — trafi i do właściciela, i do nas.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  return true;
}
