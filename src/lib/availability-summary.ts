import { addDays, toISODate } from "./calendar";

const MONTH_SHORT_PL = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paź",
  "lis",
  "gru",
];

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_SHORT_PL[m - 1]}`;
}

// Collapses a sorted list of ISO dates into human-readable contiguous ranges
// (e.g. ["2026-07-20", "2026-07-21"] -> "20 lip – 21 lip"), capped at
// maxRanges so a car available almost every day doesn't produce a wall of text.
export function summarizeAvailableRanges(
  sortedIsoDates: string[],
  maxRanges = 2
): { ranges: string[]; extraCount: number } {
  if (sortedIsoDates.length === 0) return { ranges: [], extraCount: 0 };

  const ranges: { start: string; end: string }[] = [];
  let rangeStart = sortedIsoDates[0];
  let prev = sortedIsoDates[0];

  for (let i = 1; i < sortedIsoDates.length; i++) {
    const current = sortedIsoDates[i];
    const expectedNext = toISODate(addDays(new Date(prev), 1));
    if (current !== expectedNext) {
      ranges.push({ start: rangeStart, end: prev });
      rangeStart = current;
    }
    prev = current;
  }
  ranges.push({ start: rangeStart, end: prev });

  const formatted = ranges
    .slice(0, maxRanges)
    .map((r) =>
      r.start === r.end ? formatShortDate(r.start) : `${formatShortDate(r.start)} – ${formatShortDate(r.end)}`
    );

  return { ranges: formatted, extraCount: Math.max(0, ranges.length - maxRanges) };
}
