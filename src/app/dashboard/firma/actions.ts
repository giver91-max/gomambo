"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PartnerStatus } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPartnerContext } from "@/lib/partner";
import { sendNotificationEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { isPartnerDocumentKind, partnerDocumentLabel } from "./document-kinds";

const ADMIN_ALERT_EMAIL = "user@gomambo.pl";

/**
 * NIP as bare digits. People paste it the way invoices and VIES print it —
 * "PL 123-456-32-18" — and the PL there is the EU VAT country code, not part
 * of the number. What is stored and compared is always the ten digits.
 */
function normalizeNip(raw: string): string {
  return raw.replace(/[\s.-]/g, "").replace(/^PL/i, "");
}

/** NIP is ten digits with a weighted checksum — a typo here costs an invoice. */
function isValidNip(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const check = sum % 11;
  // 10 is not a valid check digit; such a NIP cannot exist.
  return check !== 10 && check === Number(digits[9]);
}

/**
 * Something on the company's side GoMambo has to look at: the queue entry on
 * /admin (type new_partner_pending — reused for documents and corrections,
 * so no migration is needed; the body says which) and a mail to the admin
 * inbox. Never throws — the company's own save or upload has already
 * succeeded. Every value is escaped: all of it was typed by the company, and
 * the mail comes from the GoMambo domain.
 */
async function alertAdminsAboutPartner(
  admin: SupabaseClient<Database>,
  {
    queueBody,
    subject,
    intro,
    rows,
  }: {
    queueBody: string;
    subject: string;
    intro: string;
    rows: [label: string, value: string | null | undefined][];
  }
): Promise<void> {
  try {
    const { error } = await admin.from("admin_notifications").insert({
      type: "new_partner_pending",
      body: queueBody,
      link: "/admin/partnerzy",
    });
    if (error) console.error("[partner] admin notification insert failed", error);
  } catch (error) {
    console.error("[partner] admin notification threw", error);
  }

  const items = rows
    .filter((row): row is [string, string] => !!row[1])
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join("");
  await sendNotificationEmail({
    to: ADMIN_ALERT_EMAIL,
    subject: subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    html: `
      <p>${escapeHtml(intro)}</p>
      <ul>${items}</ul>
      <p><a href="${SITE_URL}/admin/partnerzy">Zweryfikuj →</a></p>
    `,
  });
}

type State = { error: string | null; success?: boolean };

// The database's own wording (English, technical) is logged, never shown.
const SAVE_FAILED = "Nie udało się zapisać danych firmy. Spróbuj ponownie za chwilę.";

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
  const nip = normalizeNip(String(formData.get("nip") ?? ""));
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
  if (!/^\d{10}$/.test(nip)) return { error: "Podaj 10 cyfr NIP." };
  if (!isValidNip(nip)) return { error: "Numer NIP jest nieprawidłowy — sprawdź cyfry." };
  if (!contactEmail) return { error: "Podaj adres e-mail do kontaktu." };

  const admin = createAdminClient();
  const existing = await getPartnerContext(supabase, user.id);

  let partnerId: string;
  let isNew = false;

  let identityChanged = false;
  // This save answers GoMambo's request for corrections (see below).
  let resubmitted = false;
  let answeredRequest: string | null = null;
  // What the partners update below replaced, to put back if the registration
  // data then fails to save (see privateError).
  let partnerBefore: {
    trade_name: string;
    city: string | null;
    description: string | null;
    status?: PartnerStatus;
    rejection_reason?: string | null;
  } | null = null;

  if (existing) {
    partnerId = existing.partnerId;

    // What GoMambo verified was a specific company: this legal name, this
    // NIP. Letting a verified Partner rewrite them in place would bind the
    // verification to a row rather than to a company — the same reason
    // editing an approved car sends it back to moderation.
    const [{ data: before }, { data: current }] = await Promise.all([
      admin
        .from("partner_private")
        .select(
          "legal_name, nip, krs, regon, address_street, address_postal_code, address_city, contact_email, contact_phone"
        )
        .eq("partner_id", partnerId)
        .maybeSingle(),
      admin
        .from("partners")
        .select("trade_name, city, description, rejection_reason")
        .eq("id", partnerId)
        .maybeSingle(),
    ]);
    identityChanged =
      existing.status === "active" &&
      !!before &&
      (before.legal_name !== legalName ||
        before.nip !== nip ||
        (before.krs ?? "") !== krs ||
        (before.regon ?? "") !== regon);

    // "Poproś o poprawki" sends the company back to 'draft' with the request
    // in rejection_reason, shown on /dashboard/firma; "Wróć do weryfikacji"
    // leaves it 'pending' with a note there, which is answered the same way.
    // Saving changed data is the answer: the company goes (back) into the
    // verification queue, the note is cleared, and the admins are told —
    // until now nothing told them, and the company waited unseen. An
    // unchanged re-save from 'draft' is not an answer, and says so rather
    // than pretending to resubmit.
    const changed =
      !before ||
      !current ||
      current.trade_name !== tradeName ||
      (current.city ?? "") !== city ||
      (current.description ?? "") !== description ||
      (before.legal_name ?? "") !== legalName ||
      (before.nip ?? "") !== nip ||
      (before.krs ?? "") !== krs ||
      (before.regon ?? "") !== regon ||
      (before.address_street ?? "") !== street ||
      (before.address_postal_code ?? "") !== postalCode ||
      (before.address_city ?? "") !== addressCity ||
      (before.contact_email ?? "") !== contactEmail ||
      (before.contact_phone ?? "") !== contactPhone;
    const correctionRequested =
      existing.status === "draft" || (existing.status === "pending" && !!current?.rejection_reason);
    if (existing.status === "draft" && !changed) {
      return {
        error: "Nic się nie zmieniło. Popraw to, o co prosimy, albo dodaj brakujący dokument poniżej.",
      };
    }
    if (correctionRequested && changed) {
      resubmitted = true;
      answeredRequest = current?.rejection_reason ?? null;
    }
    if (current) {
      partnerBefore = {
        trade_name: current.trade_name,
        city: current.city,
        description: current.description,
        ...(identityChanged || resubmitted
          ? { status: existing.status, rejection_reason: current.rejection_reason ?? null }
          : {}),
      };
    }

    const { error } = await admin
      .from("partners")
      .update({
        trade_name: tradeName,
        city: city || null,
        description: description || null,
        ...(identityChanged || resubmitted ? { status: "pending" as const } : {}),
        ...(resubmitted ? { rejection_reason: null } : {}),
      })
      .eq("id", partnerId);
    if (error) {
      console.error("[partner] could not save the company", error);
      return { error: SAVE_FAILED };
    }
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
      console.error("[partner] could not create the company", error);
      return { error: SAVE_FAILED };
    }
    partnerId = created.id;
    isNew = true;

    const { error: memberError } = await admin
      .from("partner_members")
      .insert({ partner_id: partnerId, profile_id: user.id, role: "owner" });
    if (memberError) {
      // Roll the company back rather than leave one nobody can administer.
      console.error("[partner] could not add the first member", memberError);
      await admin.from("partners").delete().eq("id", partnerId);
      return { error: SAVE_FAILED };
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
    console.error("[partner] could not save the registration data", privateError);
    // The partners update above was made in the name of this new data. Left
    // in place without it, a retry would no longer count as a correction or a
    // change of registration data: the status already 'pending' and the
    // request cleared, or — when only the name, city or description was
    // corrected — those already saved, so nothing would seem to have changed.
    // The admins would never be told and the company would wait unseen.
    // Putting all of it back makes the retry behave like the first attempt
    // and keeps the save all-or-nothing, as the error says; the trigger
    // restores the fleet with 'active' (0042).
    if (partnerBefore) {
      const { error: rollbackError } = await admin
        .from("partners")
        .update(partnerBefore)
        .eq("id", partnerId);
      if (rollbackError) {
        console.error("[partner] could not restore the company after a failed save", rollbackError);
      }
    }
    // Same for a company created a moment ago: kept without its registration
    // data, the retry would find it, update it as an existing one and never
    // send the "Nowa wypożyczalnia" alert. Its member row goes with it
    // (on delete cascade), as in the memberError rollback above.
    if (isNew) {
      await admin.from("partners").delete().eq("id", partnerId);
    }
    return { error: SAVE_FAILED };
  }

  // Losing 'active' takes the fleet off sale, but that is the
  // sync_partner_fleet_status trigger's job (0042) — it fires on the status
  // change above, atomically, whoever makes it.

  if (isNew || identityChanged || resubmitted) {
    await alertAdminsAboutPartner(admin, {
      queueBody: isNew
        ? `Nowa wypożyczalnia do weryfikacji: ${tradeName} (NIP ${nip}).`
        : identityChanged
          ? `Wypożyczalnia ${tradeName} zmieniła dane rejestrowe (NIP ${nip}) — wymaga ponownej weryfikacji.`
          : `Wypożyczalnia ${tradeName} poprawiła dane firmy (NIP ${nip}) — wróciła do weryfikacji.`,
      subject: isNew
        ? `Nowa wypożyczalnia: ${tradeName}`
        : identityChanged
          ? `Zmiana danych rejestrowych: ${tradeName}`
          : `Poprawki od wypożyczalni: ${tradeName}`,
      intro: isNew
        ? "Wypożyczalnia zgłosiła się do GoMambo i czeka na weryfikację."
        : identityChanged
          ? "Zweryfikowana wypożyczalnia zmieniła dane rejestrowe — wróciła do kolejki weryfikacji, a jej auta zostały wstrzymane."
          : "Wypożyczalnia poprawiła dane firmy po prośbie o poprawki i wróciła do kolejki weryfikacji — sprawdź je i zdecyduj.",
      rows: [
        ["Nazwa", tradeName],
        ["Firma", legalName],
        ["NIP", nip],
        ["Kontakt", contactEmail],
        ["Prośba GoMambo", answeredRequest],
      ],
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
  if (!isPartnerDocumentKind(kind)) return { error: "Nieznany rodzaj dokumentu." };

  const admin = createAdminClient();

  // Read BEFORE the insert: what the company had filed so far, and whether
  // GoMambo is waiting on a correction from it.
  const [{ data: priorDocuments }, { data: current }, { data: registration }] = await Promise.all([
    admin.from("partner_documents").select("kind").eq("partner_id", partner.partnerId),
    admin.from("partners").select("rejection_reason").eq("id", partner.partnerId).maybeSingle(),
    admin.from("partner_private").select("legal_name, nip").eq("partner_id", partner.partnerId).maybeSingle(),
  ]);

  const { error } = await admin.from("partner_documents").insert({
    partner_id: partner.partnerId,
    kind,
    storage_path: storagePath,
    original_name: originalName || null,
  });
  if (error) {
    console.error("[partner] could not record the document", error);
    return { error: "Nie udało się zapisać dokumentu. Spróbuj ponownie za chwilę." };
  }

  // The "Nowa wypożyczalnia" alert goes out when the form is saved — before
  // any document exists, because the upload only appears after that save.
  // The document is what makes verification possible, so the admins hear
  // about it too, but only at the moments that need them, never per file:
  // the company's first document, its first KRS/CEIDG extract (the one
  // verification waits for), and the answer to a correction GoMambo asked
  // for — which, as in savePartner, puts the company back into the queue
  // and clears the request.
  const answeredRequest = current?.rejection_reason ?? null;
  const correctionRequested =
    partner.status === "draft" || (partner.status === "pending" && !!answeredRequest);
  const prior = priorDocuments ?? [];
  const isRegistrationExtract = (k: string) => k === "krs" || k === "ceidg";
  const firstDocument = prior.length === 0;
  const firstExtract = isRegistrationExtract(kind) && !prior.some((d) => isRegistrationExtract(d.kind));

  if (correctionRequested || (partner.status === "pending" && (firstDocument || firstExtract))) {
    if (correctionRequested) {
      // Guarded on the status read above, so an admin decision made in the
      // meantime (say, the company was verified) is never overwritten.
      const { error: resubmitError } = await admin
        .from("partners")
        .update({ status: "pending", rejection_reason: null })
        .eq("id", partner.partnerId)
        .eq("status", partner.status);
      if (resubmitError) console.error("[partner] could not put the company back into review", resubmitError);
    }

    const label = partnerDocumentLabel(kind);
    await alertAdminsAboutPartner(admin, {
      queueBody: correctionRequested
        ? `Wypożyczalnia ${partner.tradeName} przesłała poprawki (${label}) — wróciła do weryfikacji.`
        : `Wypożyczalnia ${partner.tradeName} dodała dokument: ${label}.`,
      subject: correctionRequested
        ? `Poprawki od wypożyczalni: ${partner.tradeName}`
        : `Dokument wypożyczalni do sprawdzenia: ${partner.tradeName}`,
      intro: correctionRequested
        ? "Wypożyczalnia dodała dokument po prośbie o poprawki i wróciła do kolejki weryfikacji — sprawdź go i zdecyduj."
        : firstExtract
          ? "Wypożyczalnia dodała odpis z rejestru — można ją zweryfikować."
          : "Wypożyczalnia dodała pierwszy dokument. Do weryfikacji potrzebny jest odpis z CEIDG lub KRS — sprawdź, czy to on.",
      rows: [
        ["Nazwa", partner.tradeName],
        ["Firma", registration?.legal_name],
        ["NIP", registration?.nip],
        ["Dokument", label],
        ["Plik", originalName],
        ["Prośba GoMambo", answeredRequest],
      ],
    });
    revalidatePath("/admin/partnerzy");
  }

  revalidatePath("/dashboard/firma");
  return { error: null };
}
