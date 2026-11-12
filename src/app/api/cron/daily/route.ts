import { NextResponse } from "next/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { addDays, toISODate } from "@/lib/calendar";
import { sendPickupInstructionsIfDue } from "@/lib/pickup-instructions";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { DOCUMENTS_EXPIRED_REASON } from "@/lib/car-form";

// How long a Partner has to confirm before the request lapses. Nothing has
// been charged yet, so this costs the customer nothing but their time.
const REQUEST_EXPIRY_HOURS = 24;
import {
  raiseToGoMambo,
  requestBookingVerification,
  VERIFICATION_LEAD_DAYS,
} from "@/lib/booking-verification";

// Vercel calls this on the schedule in vercel.json and signs the call with
// CRON_SECRET. Fail closed: with no secret configured, anyone who guesses
// the path could make the platform send mail on demand.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set — refusing to run");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    console.error("[cron] service role client unavailable");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const today = toISODate(new Date());
  const tomorrow = toISODate(addDays(new Date(), 1));

  // The mail body, the withholding rule and the one-send claim all live in
  // sendPickupInstructionsIfDue, because an approval landing after this job
  // has run must be able to send the same thing.
  const { data: due, error } = await admin
    .from("bookings")
    .select("id")
    // A RANGE, not an exact match on tomorrow: instant book means a rental
    // can be booked and paid after today's run for a trip starting tomorrow
    // — or today. Those renters have the least time to ask anything.
    .gte("start_date", today)
    .lte("start_date", tomorrow)
    .eq("status", "accepted")
    .eq("payment_status", "paid")
    .is("pickup_instructions_sent_at", null);

  if (error) {
    console.error("[cron] pickup instructions query failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let withheld = 0;
  for (const booking of due ?? []) {
    if (await sendPickupInstructionsIfDue(admin, booking.id)) {
      sent += 1;
    } else {
      withheld += 1;
    }
  }

  const verificationResult = await runBookingVerifications(admin, today);
  const expiredRequests = await expireStaleRequests(admin, today);
  const carDocuments = await runCarDocumentChecks(admin, today);

  return NextResponse.json({
    ok: true,
    pickupInstructionsSent: sent,
    pickupInstructionsWithheld: withheld,
    expiredRequests,
    ...verificationResult,
    carDocuments,
  });
}

/**
 * Opens the pre-rental verification VERIFICATION_LEAD_DAYS before each trip,
 * and hands GoMambo the ones nobody acted on before the last day. Rafał's
 * rule: the owner must actually confirm — silence is not consent — but a
 * paid trip is never cancelled just because the owner was away, so it
 * escalates to a human instead.
 */
async function runBookingVerifications(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  today: string
): Promise<{ verificationsRequested: number; verificationsEscalated: number }> {
  const leadDate = toISODate(addDays(new Date(), VERIFICATION_LEAD_DAYS));

  // Everything from today up to the lead date: a booking made less than two
  // days out never has a T-2 moment, and those are the riskiest of all, so
  // they are asked as soon as the job next runs.
  const { data: due } = await admin
    .from("bookings")
    .select("id, renter_id, start_date, cars(brand, model, year)")
    .gte("start_date", today)
    .lte("start_date", leadDate)
    .eq("status", "accepted")
    .eq("payment_status", "paid");

  let requested = 0;
  for (const booking of due ?? []) {
    const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
    const created = await requestBookingVerification(admin, {
      id: booking.id,
      renter_id: booking.renter_id,
      start_date: booking.start_date,
      carLabel: car ? `${car.brand} ${car.model} (${car.year})` : "auto",
    });
    if (created) requested += 1;
  }

  // The 24-hour deadline. Rafał's rule: confirmation has to happen at the
  // latest 24h before pickup — after that it is either an urgent phone call
  // to the renter or a cancellation, and both are human decisions, so this
  // only raises the alarm.
  //
  // requested_at < today stops a row created seconds earlier in the loop
  // above from being flagged in the same run: a trip booked for tomorrow
  // would otherwise reach the renter's inbox and the urgent queue at the
  // same moment, giving nobody a chance to act.
  const deadline = toISODate(addDays(new Date(), 1));
  const { data: stale } = await admin
    .from("booking_verifications")
    .select("booking_id, status, bookings!inner(start_date, status, renter_id, owner_id, cars(brand, model, year))")
    .in("status", ["pending_renter", "pending_owner"])
    .is("escalated_at", null)
    .lt("requested_at", today)
    .lte("bookings.start_date", deadline)
    .eq("bookings.status", "accepted");

  let escalated = 0;
  for (const row of stale ?? []) {
    const { data: claimed } = await admin
      .from("booking_verifications")
      .update({ status: "escalated", escalated_at: new Date().toISOString() })
      .eq("booking_id", row.booking_id)
      .is("escalated_at", null)
      .select("booking_id")
      .maybeSingle();
    if (!claimed) continue;

    const booking = row.bookings as unknown as {
      cars: { brand: string; model: string; year: number } | null;
    } | null;
    const car = booking?.cars;
    const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";

    const waitingOn =
      row.status === "pending_renter"
        ? "Najemca nie przesłał selfie na 24 h przed odbiorem."
        : "Wynajmujący nie potwierdził najemcy na 24 h przed odbiorem.";

    await raiseToGoMambo(admin, row.booking_id, carLabel, `${waitingOn} Skontaktuj się pilnie albo anuluj rezerwację.`);

    // Both sides get told directly, because the deadline has passed and a
    // notification nobody reads is not a contact attempt.
    const bookingRow = row.bookings as unknown as { renter_id: string; owner_id: string } | null;
    if (bookingRow) {
      await notifyUser({
        userId: bookingRow.renter_id,
        type: "booking_verification_requested",
        subject: `PILNE: potwierdź tożsamość — odbiór ${carLabel} jutro`,
        body:
          row.status === "pending_renter"
            ? `Bez selfie nie wydamy auta. Zrób je teraz albo odezwij się do nas — inaczej będziemy musieli odwołać rezerwację.`
            : `Czekamy na potwierdzenie od wynajmującego. Zajmujemy się tym — odezwiemy się do Ciebie.`,
        emailHtml: `
          <p><strong>Odbiór auta jest jutro, a potwierdzenie tożsamości wciąż nie jest gotowe.</strong></p>
          <p>${escapeHtml(waitingOn)}</p>
          <p>Skontaktuj się z nami niezwłocznie — bez potwierdzenia nie możemy wydać auta i rezerwacja może zostać odwołana ze zwrotem wpłaty.</p>
          <p><a href="${SITE_URL}/dashboard/rentals">Otwórz rezerwację →</a></p>
        `,
        link: "/dashboard/rentals",
      });

      if (row.status === "pending_owner") {
        await notifyUser({
          userId: bookingRow.owner_id,
          type: "booking_verification_pending_owner",
          subject: `PILNE: potwierdź najemcę — wydanie ${carLabel} jutro`,
          body: "Bez Twojego potwierdzenia nie wyślemy najemcy danych do odbioru. Zostało mniej niż 24 h.",
          emailHtml: `
            <p><strong>Wydanie auta jest jutro, a najemca wciąż nie jest przez Ciebie potwierdzony.</strong></p>
            <p>Bez tego nie wyślemy mu numeru rejestracyjnego ani kontaktu do Ciebie. Jeśli nie zdążysz, zrobi to za Ciebie GoMambo.</p>
            <p><a href="${SITE_URL}/dashboard/bookings">Potwierdź teraz →</a></p>
          `,
          link: "/dashboard/bookings",
        });
      }
    }
    escalated += 1;
  }

  return { verificationsRequested: requested, verificationsEscalated: escalated };
}

/**
 * A Partner booking waits at 'requested' until the company confirms it.
 * Nothing else in the system ever touches that state, so an unanswered
 * request would sit there for ever — blocking nothing, but leaving the
 * customer waiting for an answer that is never coming and the dates
 * ambiguous for everyone.
 *
 * Nobody has paid at this point (payment requires 'accepted'), so expiring a
 * request costs no money and needs no refund.
 */
async function expireStaleRequests(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  today: string
): Promise<number> {
  const cutoff = new Date(Date.now() - REQUEST_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  const { data: stale } = await admin
    .from("bookings")
    .select("id, renter_id, owner_id, start_date, end_date, created_at, cars(brand, model, year)")
    .eq("status", "requested")
    // Unanswered for too long, OR the dates have simply passed — a request
    // for last week can never become a rental.
    // Quoted on purpose: an ISO timestamp carries dots and a colon, and
    // PostgREST's or() grammar is delimiter-based. The other .or() calls in
    // this codebase pass bare uuids, which have no reserved characters.
    .or(`created_at.lt."${cutoff}",start_date.lt."${today}"`);

  let expired = 0;
  for (const booking of stale ?? []) {
    const { data: claimed } = await admin
      .from("bookings")
      .update({ status: "declined" })
      .eq("id", booking.id)
      .eq("status", "requested")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
    const label = car ? `${car.brand} ${car.model} (${car.year})` : "auto";

    await notifyUser({
      userId: booking.renter_id,
      type: "booking_declined",
      subject: `Rezerwacja wygasła: ${label}`,
      body: `Wypożyczalnia nie potwierdziła rezerwacji ${label} (${booking.start_date} – ${booking.end_date}) na czas. Nic nie zapłaciłeś — wybierz inny termin albo inne auto.`,
      emailHtml: `
        <p>Twoja rezerwacja wygasła, bo wypożyczalnia nie potwierdziła jej na czas.</p>
        <ul>
          <li><strong>Auto:</strong> ${escapeHtml(label)}</li>
          <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
        </ul>
        <p><strong>Nic nie zapłaciłeś</strong> — płatność następuje dopiero po potwierdzeniu.</p>
        <p><a href="${SITE_URL}/auta">Zobacz inne auta →</a></p>
      `,
      link: "/dashboard/rentals",
    });

    await notifyUser({
      userId: booking.owner_id,
      type: "booking_declined",
      subject: `Niepotwierdzona rezerwacja wygasła: ${label}`,
      body: `Rezerwacja ${label} na ${booking.start_date} – ${booking.end_date} wygasła, bo nie została potwierdzona w ciągu ${REQUEST_EXPIRY_HOURS} godzin.`,
      emailHtml: `
        <p>Rezerwacja wygasła, bo nie została potwierdzona w ciągu ${REQUEST_EXPIRY_HOURS} godzin.</p>
        <ul>
          <li><strong>Auto:</strong> ${escapeHtml(label)}</li>
          <li><strong>Termin:</strong> ${booking.start_date} – ${booking.end_date}</li>
        </ul>
        <p>Szybsze potwierdzanie to mniej straconych rezerwacji — klient w tym czasie szuka dalej.</p>
        <p><a href="${SITE_URL}/dashboard/bookings">Twoje rezerwacje →</a></p>
      `,
      link: "/dashboard/bookings",
    });

    expired += 1;
  }

  return expired;
}

// Days before an OC policy or inspection ends on which the owner is reminded.
// Matched exactly against today's date; the pause is the safety net for a day
// the job did not run.
const DOCUMENT_REMINDER_DAYS = [30, 7];

const plDate = (iso: string) => iso.split("-").reverse().join(".");

type CarDocumentRow = {
  car_id: string;
  insurance_valid_until: string | null;
  inspection_valid_until: string | null;
  cars: { owner_id: string; brand: string; model: string; status: string } | null;
};

/**
 * Keeps the catalogue to cars that may legally be driven (0051). Owners are
 * reminded 30 and 7 days before their OC policy or technical inspection
 * runs out; on the day after, the listing is paused — renting out a car
 * without OC is a UFG penalty for the driver and leaves a renter uninsured.
 * enforce_car_update_rules keeps it paused until a current document is in.
 */
async function runCarDocumentChecks(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  today: string
): Promise<{ paused: number; reminded: number }> {
  let paused = 0;
  let reminded = 0;

  const { data: expired, error: expiredError } = await admin
    .from("car_private")
    .select("car_id, insurance_valid_until, inspection_valid_until, cars!inner(owner_id, brand, model, status)")
    .or(`insurance_valid_until.lt.${today},inspection_valid_until.lt.${today}`)
    .eq("cars.status", "approved");
  if (expiredError) console.error("[cron] expired car documents query failed", expiredError);

  for (const row of (expired ?? []) as unknown as CarDocumentRow[]) {
    if (!row.cars) continue;
    const { data: moved } = await admin
      .from("cars")
      .update({ status: "paused", rejection_reason: DOCUMENTS_EXPIRED_REASON })
      .eq("id", row.car_id)
      .eq("status", "approved")
      .select("id");
    if (!moved?.length) continue;
    paused += 1;

    const what = [
      row.insurance_valid_until && row.insurance_valid_until < today
        ? `polisa OC (ważna do ${plDate(row.insurance_valid_until)})`
        : null,
      row.inspection_valid_until && row.inspection_valid_until < today
        ? `badanie techniczne (ważne do ${plDate(row.inspection_valid_until)})`
        : null,
    ]
      .filter(Boolean)
      .join(" i ");
    const carLabel = `${row.cars.brand} ${row.cars.model}`;
    await notifyUser({
      userId: row.cars.owner_id,
      type: "car_documents",
      subject: `Wstrzymaliśmy ogłoszenie: ${carLabel}`,
      body: `Wygasła ${what} auta ${carLabel}, więc ogłoszenie jest wstrzymane. Dodaj aktualny dokument i jego datę w edycji auta — sprawdzimy go i przywrócimy ogłoszenie.`,
      emailHtml: `
        <p>Wygasła ${escapeHtml(what)} auta <strong>${escapeHtml(carLabel)}</strong>, więc wstrzymaliśmy ogłoszenie — bez ważnego OC i przeglądu auta nie wolno wynajmować.</p>
        <p>Dodaj aktualny dokument i jego datę w edycji auta. Sprawdzimy go i przywrócimy ogłoszenie.</p>
        <p><a href="${SITE_URL}/dashboard/cars/${row.car_id}/edit">Przejdź do edycji auta →</a></p>
      `,
      link: `/dashboard/cars/${row.car_id}/edit`,
    });
  }

  // Reminders: every document ending in exactly 30 or 7 days, one message per
  // car. The day is claimed on car_private.documents_reminded_on first, the
  // same claim-then-send as the rest of this job, so a second run on the same
  // day sends nothing.
  const due = new Map<string, { row: CarDocumentRow; items: string[] }>();
  for (const days of DOCUMENT_REMINDER_DAYS) {
    const target = toISODate(addDays(new Date(), days));
    const { data: rows, error: dueError } = await admin
      .from("car_private")
      .select("car_id, insurance_valid_until, inspection_valid_until, cars!inner(owner_id, brand, model, status)")
      .or(`insurance_valid_until.eq.${target},inspection_valid_until.eq.${target}`)
      .in("cars.status", ["approved", "paused", "pending"]);
    if (dueError) console.error("[cron] car document reminders query failed", dueError);

    for (const row of (rows ?? []) as unknown as CarDocumentRow[]) {
      if (!row.cars) continue;
      const entry = due.get(row.car_id) ?? { row, items: [] };
      if (row.insurance_valid_until === target) {
        entry.items.push(`polisa OC kończy się ${plDate(target)} (za ${days} dni)`);
      }
      if (row.inspection_valid_until === target) {
        entry.items.push(`badanie techniczne kończy się ${plDate(target)} (za ${days} dni)`);
      }
      due.set(row.car_id, entry);
    }
  }

  for (const [carId, { row, items }] of Array.from(due.entries())) {
    const { data: claimed } = await admin
      .from("car_private")
      .update({ documents_reminded_on: today })
      .eq("car_id", carId)
      .or(`documents_reminded_on.is.null,documents_reminded_on.neq.${today}`)
      .select("car_id");
    if (!claimed?.length || !row.cars) continue;

    const carLabel = `${row.cars.brand} ${row.cars.model}`;
    const summary = items.join("; ");
    await notifyUser({
      userId: row.cars.owner_id,
      type: "car_documents",
      subject: `Kończą się dokumenty auta: ${carLabel}`,
      body: `${carLabel}: ${summary}. Dodaj nowy dokument i datę w edycji auta przed tym dniem, inaczej ogłoszenie zostanie wstrzymane.`,
      emailHtml: `
        <p>Auto <strong>${escapeHtml(carLabel)}</strong>:</p>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <p>Dodaj nowy dokument i jego datę w edycji auta przed tym dniem — inaczej wstrzymamy ogłoszenie, bo bez ważnego OC i przeglądu auta nie wolno wynajmować. Po zmianie ogłoszenie na chwilę wróci do naszej weryfikacji.</p>
        <p><a href="${SITE_URL}/dashboard/cars/${carId}/edit">Przejdź do edycji auta →</a></p>
      `,
      link: `/dashboard/cars/${carId}/edit`,
    });
    reminded += 1;
  }

  return { paused, reminded };
}
