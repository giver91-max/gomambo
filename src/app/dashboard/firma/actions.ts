"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPartnerContext } from "@/lib/partner";
import { sendNotificationEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";

const ADMIN_ALERT_EMAIL = "user@gomambo.pl";

/** NIP is ten digits with a weighted checksum — a typo here costs an invoice. */
function isValidNip(nip: string): boolean {
  const digits = nip.replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const check = sum % 11;
  // 10 is not a valid check digit; such a NIP cannot exist.
  return check !== 10 && check === Number(digits[9]);
}

type State = { error: string | null; success?: boolean };

/**
 * Creates the company and makes the caller its first member, or updates an
 * existing one. Written with the service role because partners has no INSERT
 * policy: the row and its first partner_members row must appear together, or
 * a company would exist that nobody can administer.
 */
export async function savePartner(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tradeName = String(formData.get("trade_name") ?? "").trim();
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const nip = String(formData.get("nip") ?? "").replace(/[\s-]/g, "");
  const regon = String(formData.get("regon") ?? "").trim();
  const krs = String(formData.get("krs") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const street = String(formData.get("address_street") ?? "").trim();
  const postalCode = String(formData.get("address_postal_code") ?? "").trim();
  const addressCity = String(formData.get("address_city") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const contactPhone = String(formData.get("contact_phone") ?? "").trim();

  if (!tradeName) return { error: "Podaj nazwę, pod którą działacie." };
  if (!legalName) return { error: "Podaj pełną nazwę firmy z rejestru." };
  if (!isValidNip(nip)) return { error: "Numer NIP jest nieprawidłowy — sprawdź cyfry." };
  if (!contactEmail) return { error: "Podaj adres e-mail do kontaktu." };

  const admin = createAdminClient();
  const existing = await getPartnerContext(supabase, user.id);

  let partnerId: string;
  let isNew = false;

  let identityChanged = false;

  if (existing) {
    partnerId = existing.partnerId;

    // What GoMambo verified was a specific company: this legal name, this
    // NIP. Letting a verified Partner rewrite them in place would bind the
    // verification to a row rather than to a company — the same reason
    // editing an approved car sends it back to moderation.
    const { data: before } = await admin
      .from("partner_private")
      .select("legal_name, nip, krs, regon")
      .eq("partner_id", partnerId)
      .maybeSingle();
    identityChanged =
      existing.status === "active" &&
      !!before &&
      (before.legal_name !== legalName ||
        before.nip !== nip ||
        (before.krs ?? "") !== krs ||
        (before.regon ?? "") !== regon);

    const { error } = await admin
      .from("partners")
      .update({
        trade_name: tradeName,
        city: city || null,
        description: description || null,
        ...(identityChanged ? { status: "pending" as const } : {}),
      })
      .eq("id", partnerId);
    if (error) return { error: error.message };
  } else {
    const { data: created, error } = await admin
      .from("partners")
      .insert({
        trade_name: tradeName,
        city: city || null,
        description: description || null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !created) {
      return { error: error?.message ?? "Nie udało się zapisać firmy." };
    }
    partnerId = created.id;
    isNew = true;

    const { error: memberError } = await admin
      .from("partner_members")
      .insert({ partner_id: partnerId, profile_id: user.id, role: "owner" });
    if (memberError) {
      // Roll the company back rather than leave one nobody can administer.
      await admin.from("partners").delete().eq("id", partnerId);
      return { error: memberError.message };
    }
  }

  const { error: privateError } = await admin.from("partner_private").upsert({
    partner_id: partnerId,
    legal_name: legalName,
    nip,
    regon: regon || null,
    krs: krs || null,
    address_street: street || null,
    address_postal_code: postalCode || null,
    address_city: addressCity || null,
    contact_email: contactEmail,
    contact_phone: contactPhone || null,
  });
  if (privateError) {
    return { error: privateError.message };
  }

  // Losing 'active' takes the fleet off sale, but that is the
  // sync_partner_fleet_status trigger's job (0042) — it fires on the status
  // change above, atomically, whoever makes it.

  if (isNew || identityChanged) {
    const { error: notifyError } = await admin.from("admin_notifications").insert({
      type: "new_partner_pending",
      body: isNew
        ? `Nowa wypożyczalnia do weryfikacji: ${tradeName} (NIP ${nip}).`
        : `Wypożyczalnia ${tradeName} zmieniła dane rejestrowe (NIP ${nip}) — wymaga ponownej weryfikacji.`,
      link: "/admin/partnerzy",
    });
    if (notifyError) {
      console.error("[partner] admin notification insert failed", notifyError);
    }
    await sendNotificationEmail({
      to: ADMIN_ALERT_EMAIL,
      subject: isNew
        ? `Nowa wypożyczalnia: ${tradeName}`
        : `Zmiana danych rejestrowych: ${tradeName}`,
      html: `
        <p>${
          isNew
            ? "Wypożyczalnia zgłosiła się do GoMambo i czeka na weryfikację."
            : "Zweryfikowana wypożyczalnia zmieniła dane rejestrowe — wróciła do kolejki weryfikacji, a jej auta zostały wstrzymane."
        }</p>
        <ul>
          <li><strong>Nazwa:</strong> ${escapeHtml(tradeName)}</li>
          <li><strong>Firma:</strong> ${escapeHtml(legalName)}</li>
          <li><strong>NIP:</strong> ${escapeHtml(nip)}</li>
          <li><strong>Kontakt:</strong> ${escapeHtml(contactEmail)}</li>
        </ul>
        <p><a href="${SITE_URL}/admin/partnerzy">Zweryfikuj →</a></p>
      `,
    });
  }

  revalidatePath("/dashboard/firma");
  revalidatePath("/dashboard");
  revalidatePath("/admin/partnerzy");
  return { error: null, success: true };
}

/**
 * A registration document (KRS/CEIDG extract, insurance). Verification of it
 * is GoMambo's job — the insert policy forbids a member from filing a
 * document that already claims to be verified.
 */
export async function addPartnerDocument(
  kind: string,
  storagePath: string,
  originalName: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const partner = await getPartnerContext(supabase, user.id);
  if (!partner) return { error: "Najpierw uzupełnij dane firmy." };

  if (!storagePath.startsWith(`${partner.partnerId}/`)) {
    return { error: "Nieprawidłowa ścieżka pliku." };
  }
  const allowed = ["krs", "ceidg", "nip_confirmation", "insurance", "other"];
  if (!allowed.includes(kind)) return { error: "Nieznany rodzaj dokumentu." };

  const { error } = await createAdminClient().from("partner_documents").insert({
    partner_id: partner.partnerId,
    kind: kind as "krs" | "ceidg" | "nip_confirmation" | "insurance" | "other",
    storage_path: storagePath,
    original_name: originalName || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/firma");
  return { error: null };
}
