"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { escapeHtml } from "@/lib/html";
import { formatPriceZl } from "@/lib/money-format";
import {
  carWriteErrorMessage,
  ownerListingGate,
  parseCarDocumentsForm,
  parseCarListingForm,
} from "@/lib/car-form";
import type { Database } from "@/types/database";

export type CarFormState = { error: string | null };
export type CarDraftResult = { error: string | null; carId?: string };

const MAX_IMAGES = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What new-car-form.tsx names an upload: a random UUID and a short extension.
const UPLOADED_FILE_RE = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i;

const SAVE_FAILED =
  "Nie udało się zapisać auta. Spróbuj ponownie za chwilę — jeśli błąd się powtarza, napisz do nas na kontakt@gomambo.pl.";
const SESSION_EXPIRED =
  "Sesja wygasła. Zaloguj się ponownie — wpisane dane zostaną w tej karcie przeglądarki.";

/**
 * Everything about the form that can be refused without writing anything:
 * the listing gate, the listing fields and the documents. Shared by the
 * early check and by createCar, which must not trust that the early check
 * ran (a server action is a POST anyone can send).
 */
async function checkNewCarForm(
  supabase: SupabaseClient<Database>,
  userId: string,
  formData: FormData
) {
  const { partner, error: gateError } = await ownerListingGate(supabase, userId);
  if (gateError) return { ok: false as const, error: gateError };
  const parsed = parseCarListingForm(formData);
  if (!parsed.ok) return parsed;
  const docs = parseCarDocumentsForm(formData, { rentalRightAlreadyConfirmed: false });
  if (!docs.ok) return docs;
  return { ok: true as const, partner, parsed, docs };
}

/**
 * The form's answers checked before a single photo is uploaded, so a typo in
 * a date is reported in a second, not after eight uploads on a phone. Writes
 * nothing.
 */
export async function validateNewCar(formData: FormData): Promise<CarFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: SESSION_EXPIRED };

  const check = await checkNewCarForm(supabase, user.id, formData);
  return { error: check.ok ? null : check.error };
}

/**
 * Create the car in one go, AFTER its photos and policy are in Storage.
 *
 * It used to be the other way round: a "draft" car was inserted first and
 * the photos attached later. Any failure in between — a HEIC photo Chrome
 * cannot decode, a dropped connection, a form left open across a deploy —
 * left a 'pending' car with no photos and no policy in the admin queue, and
 * the owner's dashboard said "Sprawdzamy ogłoszenie" about something nobody
 * had sent. Now the browser picks the car's id, uploads into
 * `<user>/<carId>/`, and only then calls this. Whatever this action inserts
 * it deletes again if a later step fails, so it either returns the new car
 * or leaves nothing behind (the browser then removes the uploaded files).
 *
 * Photos go straight from the browser to Storage instead of through here
 * because Vercel caps a serverless request body at ~4.5MB — well below what
 * 8 phone photos add up to. This action only receives text.
 *
 * Returns `{ carId }` rather than redirecting: a redirect resolves the call
 * with `undefined`, which is also what a request from an older deployment
 * gets back, and the form must be able to tell success from that.
 */
export async function createCar(
  carId: string,
  imagePaths: string[],
  insurancePath: string,
  formData: FormData
): Promise<CarDraftResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: SESSION_EXPIRED };

  const check = await checkNewCarForm(supabase, user.id, formData);
  if (!check.ok) return { error: check.error };
  const { partner, parsed, docs } = check;
  const { fields, registrationNumber } = parsed;

  // The paths come from the browser: only files in this owner's folder for
  // this very car may be attached, never somebody else's.
  const folder = `${user.id}/${carId}`;
  const inFolder = (path: unknown) =>
    typeof path === "string" &&
    path.startsWith(`${folder}/`) &&
    UPLOADED_FILE_RE.test(path.slice(folder.length + 1));
  if (
    typeof carId !== "string" ||
    !UUID_RE.test(carId) ||
    !Array.isArray(imagePaths) ||
    imagePaths.length === 0 ||
    imagePaths.length > MAX_IMAGES ||
    !imagePaths.every(inFolder) ||
    !inFolder(insurancePath)
  ) {
    return { error: "Nieprawidłowe dane formularza. Odśwież stronę i spróbuj ponownie." };
  }

  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;
  if (!(await verifyRecaptcha(recaptchaToken, "add_car"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const { error: carError } = await supabase.from("cars").insert({
    id: carId,
    owner_id: user.id,
    // The company that operates the car, and Rafał's decision that a
    // Partner confirms each booking rather than having it auto-confirm.
    // Peer-to-peer listings keep instant book.
    ...(partner ? { partner_id: partner.partnerId, instant_book: false } : {}),
    ...fields,
  });
  if (carError) {
    return { error: carWriteErrorMessage(carError, SAVE_FAILED, "createCar: cars insert failed") };
  }

  // Undo for every step below: car_private and car_images go with the car
  // (on delete cascade).
  const rollback = async (message: string) => {
    const { error } = await supabase.from("cars").delete().eq("id", carId);
    if (error) console.error("createCar: rollback failed, car left behind", carId, error);
    return { error: message };
  };

  // The plate and the documents live in car_private, not on the public
  // listing row — an approved car is readable by anyone, and RLS filters
  // rows, not columns.
  const { error: privateError } = await supabase.from("car_private").upsert({
    car_id: carId,
    registration_number: registrationNumber,
    ...docs.documents,
    rental_right_confirmed_at: new Date().toISOString(),
    insurance_document_path: insurancePath,
  });
  if (privateError) {
    return rollback(
      carWriteErrorMessage(privateError, SAVE_FAILED, "createCar: car_private upsert failed")
    );
  }

  const { error: imagesError } = await supabase.from("car_images").insert(
    imagePaths.map((storage_path, position) => ({ car_id: carId, storage_path, position }))
  );
  if (imagesError) {
    return rollback(carWriteErrorMessage(imagesError, SAVE_FAILED, "createCar: car_images insert failed"));
  }

  const ownerName = String(user.user_metadata?.full_name ?? user.email ?? "nieznany");

  // Brand, model, city and the name are free text: escaped, or a "brand"
  // holding an <a href> becomes a link in a mail from the GoMambo domain.
  await sendNotificationEmail({
    to: "auto@gomambo.pl",
    subject: `Nowe auto do weryfikacji: ${fields.brand} ${fields.model}`,
    html: `
      <p>Właściciel dodał nowe auto oczekujące na zatwierdzenie.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(fields.brand)} ${escapeHtml(fields.model)} (${fields.year})</li>
        <li><strong>Miasto:</strong> ${escapeHtml(fields.city)}</li>
        <li><strong>Cena:</strong> ${formatPriceZl(fields.price_per_day)}/dzień</li>
        <li><strong>Właściciel:</strong> ${escapeHtml(ownerName)} (${escapeHtml(user.email ?? "")})</li>
      </ul>
      <p><a href="https://www.gomambo.pl/admin/cars">Przejdź do panelu admina</a></p>
    `,
  });

  const admin = createAdminClient();
  await admin.from("admin_notifications").insert({
    type: "new_car_pending",
    body: `Nowe auto do weryfikacji: ${fields.brand} ${fields.model} — ${ownerName}`,
    link: "/admin/cars",
  });

  revalidatePath("/dashboard");
  return { error: null, carId };
}

/**
 * Undo a car whose save stopped half-way on the server — the form calls it
 * only when a dropped connection left it unsure, and only a 'pending' car of
 * the caller's that never got its photos qualifies. Never a way around
 * deleteCar's checks for a real listing.
 */
export async function deleteCarDraft(carId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: SESSION_EXPIRED };

  const { count, error: countError } = await supabase
    .from("car_images")
    .select("id", { count: "exact", head: true })
    .eq("car_id", carId);
  if (countError) {
    return { error: carWriteErrorMessage(countError, SAVE_FAILED, "deleteCarDraft: count failed") };
  }
  if ((count ?? 0) > 0) return { error: "To auto ma już zdjęcia — usuń je w edycji auta." };

  const { error } = await supabase
    .from("cars")
    .delete()
    .eq("id", carId)
    .eq("owner_id", user.id)
    .eq("status", "pending");
  if (error) return { error: carWriteErrorMessage(error, SAVE_FAILED, "deleteCarDraft: delete failed") };
  return { error: null };
}
