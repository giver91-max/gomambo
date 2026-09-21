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

export type PriceBreakdown = {
  /** The owner's own price for the period — what they are paid in full. */
  rental: number;
  /** Platform fee, charged to the renter on top of the owner's price. */
  commission: number;
  /** What the renter actually pays. */
  gross: number;
};

// The platform fee is added ON TOP of the owner's price rather than deducted
// from it: the owner receives their listed price, and the renter sees the fee
// as its own line before booking. Single source of truth for that maths —
// the checkout, the stored amounts and the price shown in the UI all use it.
export function applyCommission(rentalTotal: number, commissionRate: number): PriceBreakdown {
  const commission = Math.round(rentalTotal * commissionRate * 100) / 100;
  return {
    rental: rentalTotal,
    commission,
    gross: Math.round((rentalTotal + commission) * 100) / 100,
  };
}
