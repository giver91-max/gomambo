"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";

export type InquiryState = { error: string | null; success?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendInquiry(
  _prevState: InquiryState,
  formData: FormData
): Promise<InquiryState> {
  // Honeypot: real users never fill a field named "website" that isn't shown.
  if (String(formData.get("website") ?? "")) {
    return { error: null, success: true };
  }

  const carId = String(formData.get("carId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const rangeStart = String(formData.get("rangeStart") ?? "").trim();
  const rangeEnd = String(formData.get("rangeEnd") ?? "").trim();

  if (!carId || !name || !email || !message) {
    return { error: "Wypełnij imię, e-mail i wiadomość." };
  }
  if (!EMAIL_RE.test(email)) {
    return { error: "Podaj prawidłowy adres e-mail." };
  }

  const supabase = await createClient();
  const { data: car } = await supabase
    .from("cars")
    .select("brand, model, year, city, owner_id")
    .eq("id", carId)
    .eq("status", "approved")
    .single();

  if (!car) {
    return { error: "Nie znaleziono ogłoszenia." };
  }

  const admin = createAdminClient();
  const { data: ownerAuth } = await admin.auth.admin.getUserById(car.owner_id);
  const ownerEmail = ownerAuth?.user?.email;

  if (!ownerEmail) {
    return { error: "Nie udało się skontaktować z właścicielem. Spróbuj ponownie później." };
  }

  await sendNotificationEmail({
    to: ownerEmail,
    subject: `Zapytanie o dostępność: ${car.brand} ${car.model}`,
    html: `
      <p>Ktoś jest zainteresowany Twoim ogłoszeniem na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${car.brand} ${car.model} (${car.year}), ${car.city}</li>
        <li><strong>Imię:</strong> ${name}</li>
        <li><strong>E-mail:</strong> ${email}</li>
        ${phone ? `<li><strong>Telefon:</strong> ${phone}</li>` : ""}
        ${
          rangeStart
            ? `<li><strong>Wybrany termin:</strong> ${rangeStart}${rangeEnd ? ` – ${rangeEnd}` : ""}</li>`
            : ""
        }
      </ul>
      <p><strong>Wiadomość:</strong></p>
      <p>${message.replace(/\n/g, "<br>")}</p>
    `,
  });

  return { error: null, success: true };
}
