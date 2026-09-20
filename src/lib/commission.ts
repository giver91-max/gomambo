import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_COMMISSION_RATE = 0.15;

type CommissionFields = {
  commission_rate: number | string | null | undefined;
  commission_rate_until: string | null | undefined;
};

// Fraction (0–1) the platform keeps from a rental. A per-owner override
// (fleet promo) wins while it hasn't lapsed; anything malformed falls back
// to the default rather than to 0. Strictly < 1: Stripe requires the
// application fee to be less than the charge amount.
export function resolveCommissionRate(
  override: CommissionFields | null,
  now: Date = new Date()
): number {
  if (!override || override.commission_rate === null || override.commission_rate === undefined) {
    return DEFAULT_COMMISSION_RATE;
  }
  if (override.commission_rate_until && new Date(override.commission_rate_until) <= now) {
    return DEFAULT_COMMISSION_RATE;
  }
  const rate = Number(override.commission_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    return DEFAULT_COMMISSION_RATE;
  }
  return rate;
}

// PostgREST codes for "migration 0033 hasn't been applied yet" (table not in
// the schema cache / undefined table). Expected during the deploy window, so
// they fall back quietly. Anything else is logged in full and surfaced to
// admins: a silent fallback bills 15% to an owner who was promised 0%.
const EXPECTED_PRE_MIGRATION_CODES = new Set(["PGRST205", "42P01"]);

type FallbackContext = { bookingId?: string; extensionId?: string };

// Service-role read, independent of the renter's RLS view. Any failure falls
// back to the default rate so the promo machinery can never block a checkout.
export async function getOwnerCommissionRate(
  ownerId: string,
  context: FallbackContext = {}
): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("owner_commission_overrides")
      .select("commission_rate, commission_rate_until")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) {
      // Always log — a 0%-promo owner being billed 15% must never be
      // invisible. Only the admin notification is suppressed pre-migration,
      // because its own type CHECK doesn't exist yet either.
      const preMigration = EXPECTED_PRE_MIGRATION_CODES.has(error.code);
      console.error("[commission-fallback]", {
        ownerId,
        ...context,
        code: error.code,
        message: error.message,
        details: error.details,
        preMigration,
      });
      if (!preMigration) {
        await reportCommissionFallback(ownerId, context, {
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }
      return DEFAULT_COMMISSION_RATE;
    }
    return resolveCommissionRate(data);
  } catch (error) {
    await reportCommissionFallback(ownerId, context, {
      message: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_COMMISSION_RATE;
  }
}

async function reportCommissionFallback(
  ownerId: string,
  context: FallbackContext,
  error: { code?: string; message: string; details?: string | null }
): Promise<void> {
  try {
    const admin = createAdminClient();
    const where = context.bookingId
      ? ` Rezerwacja ${context.bookingId}${context.extensionId ? `, przedłużenie ${context.extensionId}` : ""}.`
      : "";
    // supabase-js resolves DB errors into { error } instead of throwing, so
    // the catch below would never see a rejected INSERT (e.g. a type CHECK
    // violation) — read it explicitly.
    const { error: insertError } = await admin.from("admin_notifications").insert({
      type: "commission_fallback",
      body: `Nie udało się odczytać stawki prowizji właściciela (${error.message}) — naliczono domyślne 15%.${where}`,
      link: `/admin/users/${ownerId}`,
    });
    if (insertError) {
      console.error("[commission-fallback] admin notification insert failed", {
        code: insertError.code,
        message: insertError.message,
      });
    }
  } catch (notifyError) {
    console.error("[commission-fallback] admin notification threw", notifyError);
  }
}
