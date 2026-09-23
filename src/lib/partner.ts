import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PartnerMemberRole, PartnerStatus } from "@/types/database";

export type PartnerContext = {
  partnerId: string;
  tradeName: string;
  status: PartnerStatus;
  role: PartnerMemberRole;
};

/**
 * The company the signed-in account acts for, if any.
 *
 * One account belongs to at most one Partner today. That is a product
 * simplification, not a schema one — partner_members is a join table, so a
 * person working for two rental companies is a query change, not a migration.
 */
export async function getPartnerContext(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<PartnerContext | null> {
  const { data } = await supabase
    .from("partner_members")
    .select("partner_id, role, partners(trade_name, status)")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const partner = data.partners as unknown as {
    trade_name: string;
    status: PartnerStatus;
  } | null;
  if (!partner) return null;

  return {
    partnerId: data.partner_id,
    tradeName: partner.trade_name,
    status: partner.status,
    role: data.role,
  };
}

/**
 * Whether this Partner may list cars and take bookings.
 *
 * A company that has not been verified by GoMambo must not appear in the
 * catalogue: the whole point of the Partner model is that the customer is
 * told who is renting them the car, and an unverified "who" is worse than
 * none. Kept as one function so the rule can't drift between the listing
 * gate, the car form and the admin view.
 */
export function partnerCanList(status: PartnerStatus): boolean {
  return status === "active";
}

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  draft: "Szkic — uzupełnij dane",
  pending: "Czeka na weryfikację GoMambo",
  active: "Zweryfikowana",
  suspended: "Zawieszona",
  terminated: "Współpraca zakończona",
};
