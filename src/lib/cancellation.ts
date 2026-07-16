import { CANCELLATION_POLICY_FREE_HOURS } from "@/lib/car-options";
import type { CancellationPolicy } from "@/types/database";

export function freeCancellationDeadline(policy: CancellationPolicy, startDate: string): Date {
  const freeHours = CANCELLATION_POLICY_FREE_HOURS[policy];
  return new Date(new Date(`${startDate}T00:00:00`).getTime() - freeHours * 60 * 60 * 1000);
}

export function isWithinFreeCancellationWindow(
  policy: CancellationPolicy,
  startDate: string
): boolean {
  return new Date() < freeCancellationDeadline(policy, startDate);
}
