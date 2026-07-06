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
