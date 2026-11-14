export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

export type CalendarDay = { date: Date; iso: string; inMonth: boolean };

export function getMonthGrid(month: Date): CalendarDay[] {
  const first = startOfMonth(month);
  const firstWeekday = (first.getDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(first, -firstWeekday);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    days.push({ date, iso: toISODate(date), inMonth: date.getMonth() === month.getMonth() });
  }
  return days;
}

export function eachDateInRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(startIso);
  const end = new Date(endIso);
  while (toISODate(cursor) <= toISODate(end)) {
    dates.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export const MONTH_NAMES_PL = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

export const WEEKDAY_NAMES_PL = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];

// The business runs on Polish calendar days, the server does not: Vercel
// runs in UTC, so between midnight and 01:00/02:00 Polish time `new Date()`
// still reads yesterday. Anything that decides a money or cancellation rule
// by date ("from the start date on", "three days after return") uses these
// instead, so the rule flips at Polish midnight — the same moment the
// database trigger uses (now() at time zone 'Europe/Warsaw').
export const APP_TIME_ZONE = "Europe/Warsaw";

function zonedParts(instant: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** Today's date in Poland as YYYY-MM-DD. */
export function todayInPoland(now: Date = new Date()): string {
  const p = zonedParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Calendar arithmetic on a YYYY-MM-DD string, independent of any time zone. */
export function addDaysIso(isoDate: string, count: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + count));
  return date.toISOString().slice(0, 10);
}

/** The instant a Polish calendar day begins (00:00 in Warsaw), DST included. */
export function startOfDayInPoland(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wallClock = Date.UTC(y, m - 1, d);
  const offsetAt = (instant: number) => {
    const p = zonedParts(new Date(instant));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
  };
  // Twice: the first guess can sit on the other side of a DST switch.
  let instant = wallClock - offsetAt(wallClock);
  instant = wallClock - offsetAt(instant);
  return new Date(instant);
}

/** A date or timestamp as the Polish calendar day it falls on, e.g. "14.11.2026". */
export function formatDatePl(value: string | Date): string {
  const instant = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? startOfDayInPoland(value)
    : new Date(value);
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(instant);
}

/** A timestamp as Polish date and time, e.g. "17.11.2026, 15:00". */
export function formatDateTimePl(value: string | Date): string {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
