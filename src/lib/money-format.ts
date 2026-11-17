/**
 * Prices on GoMambo are whole złoty: never show or accept grosze in a price.
 * Database numerics arrive as strings like "250.00", so accept those too.
 */
export function wholeZl(amount: number | string | null | undefined): number {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  return Number.isFinite(n) ? Math.round(n as number) : 0;
}

/** "1 250 zł" — whole złoty with a Polish thousands separator. */
export function formatPriceZl(amount: number | string | null | undefined): string {
  return `${wholeZl(amount).toLocaleString("pl-PL")} zł`;
}
