// The security deposit, as GoMambo takes it since migration 0052 — the pure
// half: amounts, deadlines and labels. Safe to import from client components;
// everything that touches Stripe or the database is in deposit-service.ts.
//
// How it works, in Rafał's words turned into rules:
//  - the deposit is a real payment (card or BLIK), not a hold on a card, and
//    it is asked for together with the pre-rental selfie, two days before
//    pickup (or straight after the rental is paid when pickup is sooner);
//  - the pickup details are only sent once it is paid;
//  - after the car comes back the owner has DEPOSIT_REVIEW_DAYS to confirm
//    it is fine or to keep part of it for damage — silence means it goes
//    back to the renter in full;
//  - a kept amount waits DEPOSIT_OBJECTION_DAYS for the renter's objection
//    before it is passed on to the owner.

import type { BookingDeposit, DepositState } from "@/types/database";
import { addDaysIso, formatDatePl, formatDateTimePl, startOfDayInPoland } from "@/lib/calendar";

/**
 * Days before pickup on which the renter is asked to pay. The same moment as
 * VERIFICATION_LEAD_DAYS in booking-verification.ts (server-only, so it can't
 * be imported into the pages that quote this number) — keep the two equal.
 */
export const DEPOSIT_REQUEST_LEAD_DAYS = 2;

/**
 * The least time a renter gets to pay once asked. Normally the deadline is
 * the start of pickup day, two days after the request — but a trip booked
 * (or paid) late is asked for the deposit on the evening before pickup or on
 * pickup day itself, and without this the owner could cancel it for
 * non-payment a minute later, keeping the rental money. Rafał's plan names no
 * number; 12 hours gives a renter who booked the evening before the whole
 * morning, and one who booked for the same day the rest of that day.
 */
export const DEPOSIT_LATE_REQUEST_GRACE_HOURS = 12;

/**
 * When the deposit counts as overdue — the moment from which the owner may
 * cancel for non-payment: the start of pickup day, or DEPOSIT_LATE_REQUEST_GRACE_HOURS
 * after the request, whichever is later.
 */
export function depositDueAt(startDate: string, requestedAt: Date): Date {
  const pickupDay = startOfDayInPoland(startDate).getTime();
  const grace = requestedAt.getTime() + DEPOSIT_LATE_REQUEST_GRACE_HOURS * 60 * 60 * 1000;
  return new Date(Math.max(pickupDay, grace));
}

/**
 * The payment deadline as the renter is told it. Never "odbiór jest już
 * dziś" for a pickup that was yesterday, and never the end of the day before
 * pickup when the real deadline (depositDueAt) is later than that.
 */
export function depositDueText(
  startDate: string,
  dueAt: string | Date | null,
  today: string,
  now: Date = new Date()
): string {
  const due = dueAt ? new Date(dueAt) : null;
  if (startDate > today) {
    if (!due || due.getTime() <= startOfDayInPoland(startDate).getTime()) {
      return `do końca dnia ${formatDatePl(addDaysIso(startDate, -1))}`;
    }
    return `do ${formatDateTimePl(due)}`;
  }
  const pickup = startDate === today ? "odbiór jest już dziś" : "termin odbioru już minął";
  return due && due > now
    ? `jak najszybciej — ${pickup} (najpóźniej do ${formatDateTimePl(due)})`
    : `jak najszybciej — ${pickup}`;
}

/** How long the owner has to check the car after it comes back. */
export const DEPOSIT_REVIEW_DAYS = 3;

/** How long the renter has to object before a kept amount reaches the owner. */
export const DEPOSIT_OBJECTION_DAYS = 3;

/**
 * The renter's non-refundable "opłata za obsługę kaucji": a flat, tiered fee
 * for GoMambo's handling of the deposit — collecting it, keeping it until the
 * rental is settled, and returning or passing it on afterwards. Rafał's
 * tiers. It is the same whatever the renter pays with, and it is shown on the
 * car page and in the booking summary before anything is booked.
 *
 * Whole złoty, computed in grosze so that 2% of an amount like 3500 zł can
 * never come out as 70.000000001 and round up to 71.
 */
export function depositFee(depositPln: number): number {
  if (!(depositPln > 0)) return 0;
  if (depositPln <= 1000) return 20;
  if (depositPln <= 2000) return 40;
  if (depositPln <= 3000) return 60;
  const grosze = Math.round(depositPln * 100);
  return Math.ceil((grosze * 2) / 10000);
}

/** Money as the rest of the site shows it, without a pointless ".00". */
export function formatZl(amountPln: number): string {
  const rounded = Math.round(amountPln * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)} zł`;
}

export function roundPln(amountPln: number): number {
  return Math.round(amountPln * 100) / 100;
}

// Every state the money can be in. 'transferring' and 'transfer_failed' are
// the leg where a kept amount goes to the owner; what goes back to the
// renter is tracked separately in refund_status, because one deposit can
// have both legs at once (part kept, the rest returned).
export const DEPOSIT_STATE_LABELS: Record<DepositState, string> = {
  requested: "Czeka na wpłatę",
  processing: "Płatność w toku",
  paid: "Wpłacona",
  in_review: "Sprawdzanie auta",
  retention_pending: "Zatrzymana — czas na sprzeciw",
  retention_objected: "Sprzeciw najemcy",
  transferring: "Przelew do właściciela",
  transfer_failed: "Przelew do właściciela nieudany",
  settled: "Rozliczona",
  voided: "Niewpłacona (anulowana)",
  disputed: "Reklamacja w banku",
};

/** States in which GoMambo holds the renter's money. */
export const DEPOSIT_HELD_STATES: readonly DepositState[] = [
  "paid",
  "in_review",
  "retention_pending",
  "retention_objected",
  "transferring",
  "transfer_failed",
  "disputed",
];

/** States an admin has to look at — nothing automatic will move them on. */
export const DEPOSIT_ADMIN_STATES: readonly DepositState[] = [
  "retention_objected",
  "transfer_failed",
  "disputed",
];

/**
 * The amount an admin can still decide on in a retention: the whole kept
 * part while the renter may object or has objected; after a transfer to the
 * owner failed, only that transfer's amount — an earlier decision may already
 * have sent the rest of the kept part back to the renter. Null when none.
 */
export function decidableRetention(
  deposit: Pick<BookingDeposit, "status" | "retained_amount" | "transfer_amount">
): number | null {
  const value = deposit.status === "transfer_failed" ? deposit.transfer_amount : deposit.retained_amount;
  return value !== null && Number(value) > 0 ? Number(value) : null;
}

/**
 * The deposit and fee a booking carries. Both are pinned on the booking when
 * it is made (sendInquiry). A booking made before that existed has neither,
 * and falls back to the car's current deposit — the old flow charged that
 * amount at payment time too, so the renter was shown it before booking.
 */
export function bookingDepositAmounts(
  bookingDeposit: number | string | null,
  bookingFee: number | string | null,
  carDeposit: number | string | null
): { amount: number; fee: number } {
  const raw =
    bookingDeposit !== null ? Number(bookingDeposit) : carDeposit !== null ? Number(carDeposit) : 0;
  const amount = raw > 0 ? roundPln(raw) : 0;
  if (amount === 0) return { amount: 0, fee: 0 };
  const fee = bookingFee !== null ? Number(bookingFee) : depositFee(amount);
  return { amount, fee: roundPln(fee) };
}
