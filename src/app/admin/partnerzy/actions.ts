"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import type { NotificationType, PartnerStatus } from "@/types/database";
import { PARTNER_STATUS_LABELS } from "@/lib/partner";

type Decision = Extract<PartnerStatus, "active" | "suspended" | "terminated" | "pending" | "draft">;

/**
 * What the company's members are told, per decision. Each has its own
 * notification type (0053) — they used to be filed as "Auto zatwierdzone" /
 * "Auto odrzucone". If 0053 is not applied yet, notifyUser stores the in-app
 * row under the legacy car_approved / car_rejected type instead (labelled by
 * its /dashboard/firma link), and the e-mail goes out either way.
 */
function decisionMessage(
  status: Decision,
  tradeName: string,
  reason: string
): { type: NotificationType; subject: string; body: string; emailHtml: string } {
  const name = escapeHtml(tradeName);
  if (status === "active") {
    return {
      type: "partner_approved",
      subject: `Wypożyczalnia ${tradeName} zweryfikowana`,
      body: "Możecie dodawać auta do GoMambo. Każde ogłoszenie przechodzi jeszcze krótką moderację.",
      emailHtml: `
            <p>Zweryfikowaliśmy ${name} — możecie dodawać auta.</p>
            <p>Każde ogłoszenie przechodzi jeszcze krótką moderację, zanim trafi do katalogu.
            Rezerwacje w Waszych autach wymagają Waszego potwierdzenia — klient nie rezerwuje
            automatycznie.</p>
            <p><a href="${SITE_URL}/dashboard/cars/new">Dodaj pierwsze auto →</a></p>
          `,
    };
  }
  if (status === "draft") {
    // A correction, not a verdict: the company fixes the data or adds the
    // document, and the verification carries on. Worded so, because the only
    // option with a reason field used to be "Zakończ współpracę".
    return {
      type: "partner_changes_requested",
      subject: `Wypożyczalnia ${tradeName} — prosimy o uzupełnienie`,
      body: `Zanim zweryfikujemy wypożyczalnię, prosimy o poprawki: ${reason}${
        /[.!?]$/.test(reason) ? "" : "."
      } Uzupełnijcie je w panelu firmy — wtedy sprawdzimy firmę ponownie.`,
      emailHtml: `
            <p>Sprawdzamy ${name} i zanim zweryfikujemy firmę, prosimy o poprawki:</p>
            <p><strong>${escapeHtml(reason)}</strong></p>
            <p>Uzupełnijcie dane albo dodajcie dokument w panelu firmy — wtedy sprawdzimy firmę ponownie.</p>
            <p><a href="${SITE_URL}/dashboard/firma">Przejdź do panelu firmy →</a></p>
          `,
    };
  }
  return {
    type: "partner_status_changed",
    subject: `Wypożyczalnia ${tradeName} — wymagane działanie`,
    body: `Status współpracy: ${PARTNER_STATUS_LABELS[status]}. ${reason}`,
    emailHtml: `
            <p>Status współpracy z ${name}: <strong>${escapeHtml(PARTNER_STATUS_LABELS[status])}</strong>.</p>
            <p>${escapeHtml(reason)}</p>
            <p><a href="${SITE_URL}/dashboard/firma">Przejdź do panelu firmy →</a></p>
          `,
  };
}

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
  status: Decision,
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
    return {
      error: error ? `Nie udało się zapisać decyzji: ${error.message}` : "Nie udało się zapisać decyzji.",
    };
  }

  // Pausing and restoring this partner's fleet is done by the
  // sync_partner_fleet_status trigger (0042), in the same transaction as the
  // status change above. Doing it here as a second statement meant a
  // suspension could half-apply and still report success.

  const { data: members } = await admin
    .from("partner_members")
    .select("profile_id")
    .eq("partner_id", partnerId);

  const message = decisionMessage(status, partner.trade_name, trimmed);
  for (const member of members ?? []) {
    await notifyUser({
      userId: member.profile_id,
      ...message,
      link: "/dashboard/firma",
      // Until 0053 is applied the partner_* types are refused by the CHECK;
      // the notifications page labels these legacy types by their
      // /dashboard/firma link as company decisions.
      fallbackType: message.type === "partner_approved" ? "car_approved" : "car_rejected",
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

  if (error) return { error: `Nie udało się oznaczyć dokumentu: ${error.message}` };

  revalidatePath("/admin/partnerzy");
  return { error: null };
}
