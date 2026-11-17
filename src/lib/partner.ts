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
 * How many registration documents the company has filed. A company is
 * created as 'pending' straight from the form, before any document exists —
 * GoMambo cannot start checking it until there is one, so pages must not tell
 * such a company "we are checking your documents".
 */
export async function countPartnerDocuments(
  supabase: SupabaseClient<Database>,
  partnerId: string
): Promise<number> {
  const { count } = await supabase
    .from("partner_documents")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", partnerId);
  return count ?? 0;
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
  // 'draft' is where "Poproś o poprawki" (admin/partnerzy) sends a company
  // — the company sees this on its badge, so it says what to do, not "szkic".
  draft: "Do poprawy — uzupełnij dane",
  pending: "Czeka na weryfikację GoMambo",
  active: "Zweryfikowana",
  suspended: "Zawieszona",
  terminated: "Współpraca zakończona",
};

/**
 * Why a trip on a company's car cannot be extended from the renter's panel.
 *
 * Rafał's rule: every booking of a Partner car is confirmed by the company
 * (the same rule that keeps instant_book off for Partner cars, 0042). An
 * extension is a booking of more days, and the self-service one is paid and
 * applied without anyone at the company agreeing or looking at its fleet
 * calendar — so for a Partner car it is refused, and the renter is sent to
 * the company instead. One string for the server action that refuses it and
 * the rentals page that hides the form, so the two cannot drift.
 */
export const PARTNER_EXTENSION_REFUSAL =
  "Przedłużenie najmu w wypożyczalni wymaga jej zgody. Napisz do wypożyczalni w wiadomościach albo wyślij nową prośbę o rezerwację na kolejne dni.";
