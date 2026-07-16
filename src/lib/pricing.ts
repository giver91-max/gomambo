import { eachDateInRange } from "@/lib/calendar";

export const MONTHLY_THRESHOLD_NIGHTS = 28;

export type BookingPrice = {
  nights: number;
  useMonthly: boolean;
  months: number | null;
  total: number;
};

export function calculateBookingPrice(
  pricePerDay: number,
  pricePerMonth: number | null,
  startDate: string,
  endDate: string
): BookingPrice {
  const nights = eachDateInRange(startDate, endDate).length;
  const useMonthly = pricePerMonth !== null && nights >= MONTHLY_THRESHOLD_NIGHTS;
  const months = useMonthly ? Math.round((nights / 30) * 10) / 10 : null;
  const total = useMonthly ? (pricePerMonth as number) * (months as number) : pricePerDay * nights;
  return { nights, useMonthly, months, total };
}
