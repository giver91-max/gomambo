"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extendDepositWindow,
  markDepositSettledManually,
  refundDepositFee,
  resolveRetention,
  retryDepositRefund,
  retryRetentionTransfer,
  reverseTransferToRenter,
} from "@/lib/deposit-service";

// Every action here moves or closes someone else's money, so each one
// re-checks the role itself — the layout's redirect does not protect a
// server action, which is callable on its own.
async function requireAdmin(): Promise<{
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }
  return { admin: createAdminClient(), userId: user.id };
}

function refresh() {
  revalidatePath("/admin/kaucje");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
}

/**
 * Rafał's options for a kept amount the renter objected to: all of it to the
 * owner, all of it back to the renter, or a split — `ownerAmountPln` is the
 * owner's part, the rest goes back.
 */
export async function adminResolveRetention(
  bookingId: string,
  ownerAmountPln: number
): Promise<{ error: string | null }> {
  const { admin, userId } = await requireAdmin();
  if (!Number.isFinite(ownerAmountPln)) return { error: "Podaj kwotę dla właściciela." };
  const result = await resolveRetention(admin, bookingId, { ownerAmountPln, adminId: userId });
  refresh();
  return result;
}

export async function adminRetryDepositRefund(bookingId: string): Promise<{ error: string | null }> {
  const { admin } = await requireAdmin();
  const result = await retryDepositRefund(admin, bookingId);
  refresh();
  return result;
}

export async function adminRetryDepositTransfer(bookingId: string): Promise<{ error: string | null }> {
  const { admin } = await requireAdmin();
  const result = await retryRetentionTransfer(admin, bookingId);
  refresh();
  return result;
}

export async function adminExtendDepositWindow(bookingId: string): Promise<{ error: string | null }> {
  const { admin } = await requireAdmin();
  const result = await extendDepositWindow(admin, bookingId);
  refresh();
  return result;
}

export async function adminMarkDepositSettled(bookingId: string): Promise<{ error: string | null }> {
  const { admin, userId } = await requireAdmin();
  const result = await markDepositSettledManually(admin, bookingId, userId);
  refresh();
  return result;
}

export async function adminReverseDepositTransfer(
  bookingId: string
): Promise<{ error: string | null }> {
  const { admin, userId } = await requireAdmin();
  const result = await reverseTransferToRenter(admin, bookingId, userId);
  refresh();
  return result;
}

/**
 * Returns the deposit's handling fee of a cancelled booking that was not the
 * renter's doing — for when the daily job had to assume it was (no recorded
 * decision; see reconcileDeposits in deposit-service.ts).
 */
export async function adminRefundDepositFee(bookingId: string): Promise<{ error: string | null }> {
  const { admin, userId } = await requireAdmin();
  const result = await refundDepositFee(admin, bookingId, userId);
  refresh();
  return result;
}
