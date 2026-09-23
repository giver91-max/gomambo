"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import type { PartnerStatus } from "@/types/database";


async function requireAdmin() {
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
  if (profile?.role !== "admin") redirect("/dashboard");

  return { admin: createAdminClient(), userId: user.id };
}

/**
 * GoMambo's decision on a company. Activating it is what lets the Partner
 * list cars at all — the status is pinned against the Partner's own writes
 * by enforce_partner_column_rules, so this is the only way in.
 */
export async function decidePartner(
  partnerId: string,
  status: Extract<PartnerStatus, "active" | "suspended" | "terminated" | "pending">,
  reason: string
): Promise<{ error: string | null }> {
  const { admin } = await requireAdmin();
  const trimmed = reason.trim();

  if (status !== "active" && !trimmed) {
    return { error: "Napisz powód — wypożyczalnia musi wiedzieć, co poprawić." };
  }

  const { data: partner, error } = await admin
    .from("partners")
    .update({ status, rejection_reason: status === "active" ? null : trimmed })
    .eq("id", partnerId)
    .select("trade_name")
    .single();

  if (error || !partner) {
    return { error: error?.message ?? "Nie udało się zapisać decyzji." };
  }

  // Pausing and restoring this partner's fleet is done by the
  // sync_partner_fleet_status trigger (0042), in the same transaction as the
  // status change above. Doing it here as a second statement meant a
  // suspension could half-apply and still report success.

  const { data: members } = await admin
    .from("partner_members")
    .select("profile_id")
    .eq("partner_id", partnerId);

  for (const member of members ?? []) {
    await notifyUser({
      userId: member.profile_id,
      type: status === "active" ? "car_approved" : "car_rejected",
      subject:
        status === "active"
          ? `Wypożyczalnia ${partner.trade_name} zweryfikowana`
          : `Wypożyczalnia ${partner.trade_name} — wymagane działanie`,
      body:
        status === "active"
          ? "Możecie dodawać auta do GoMambo. Każde ogłoszenie przechodzi jeszcze krótką moderację."
          : `Status współpracy: ${status}. ${trimmed}`,
      emailHtml:
        status === "active"
          ? `
            <p>Zweryfikowaliśmy ${escapeHtml(partner.trade_name)} — możecie dodawać auta.</p>
            <p>Każde ogłoszenie przechodzi jeszcze krótką moderację, zanim trafi do katalogu.
            Rezerwacje w Waszych autach wymagają Waszego potwierdzenia — klient nie rezerwuje
            automatycznie.</p>
            <p><a href="${SITE_URL}/dashboard/cars/new">Dodaj pierwsze auto →</a></p>
          `
          : `
            <p>Status współpracy z ${escapeHtml(partner.trade_name)}: <strong>${escapeHtml(status)}</strong>.</p>
            <p>${escapeHtml(trimmed)}</p>
            <p><a href="${SITE_URL}/dashboard/firma">Przejdź do panelu firmy →</a></p>
          `,
      link: "/dashboard/firma",
    });
  }

  revalidatePath("/admin/partnerzy");
  return { error: null };
}

export async function verifyPartnerDocument(documentId: string): Promise<{ error: string | null }> {
  const { admin, userId } = await requireAdmin();

  const { error } = await admin
    .from("partner_documents")
    .update({ verified_at: new Date().toISOString(), verified_by: userId })
    .eq("id", documentId)
    .is("verified_at", null);

  if (error) return { error: error.message };

  revalidatePath("/admin/partnerzy");
  return { error: null };
}
