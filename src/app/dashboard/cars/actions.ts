"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { getVerificationStatus } from "@/lib/verification-gate";
import { getPartnerContext, partnerCanList } from "@/lib/partner";
import { parseCarListingForm } from "@/lib/car-form";

export type CarFormState = { error: string | null };
export type CarDraftResult = { error: string | null; carId?: string };

// Photos are uploaded straight from the browser to Supabase Storage (see
// new-car-form.tsx) instead of passing through this server action, because
// Vercel's serverless functions hard-cap request bodies at ~4.5MB — well
// below what 8 real phone photos add up to. This action only ever receives
// small text fields, so it stays far under that limit.
export async function createCarDraft(
  _prevState: CarFormState,
  formData: FormData
): Promise<CarDraftResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Two different gates, because two different things are being checked. An
  // individual listing their own car is vouched for by their identity and
  // driving licence. A rental company has no driving licence — what matters
  // is that the COMPANY is real and verified, which is what makes it
  // possible for a Partner to list at all (it was not, before 0042).
  const partner = await getPartnerContext(supabase, user.id);
  if (partner) {
    if (!partnerCanList(partner.status)) {
      return {
        error:
          partner.status === "pending"
            ? "Weryfikujemy jeszcze Twoją wypożyczalnię — damy znać, gdy będziesz mógł dodawać auta."
            : "Twoja wypożyczalnia nie może w tej chwili dodawać aut. Napisz do nas.",
      };
    }
  } else {
    const { status: verificationStatus } = await getVerificationStatus(supabase, user.id);
    if (verificationStatus !== "approved") {
      return { error: "Musisz najpierw zweryfikować tożsamość i prawo jazdy, zanim dodasz auto." };
    }
  }

  const parsed = parseCarListingForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }
  const { fields, registrationNumber } = parsed;
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;
  if (!(await verifyRecaptcha(recaptchaToken, "add_car"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const { data: car, error: carError } = await supabase
    .from("cars")
    .insert({
      owner_id: user.id,
      // The company that operates the car, and Rafał's decision that a
      // Partner confirms each booking rather than having it auto-confirm.
      // Peer-to-peer listings keep instant book.
      ...(partner ? { partner_id: partner.partnerId, instant_book: false } : {}),
      ...fields,
    })
    .select("id")
    .single();

  if (carError || !car) {
    return { error: carError?.message ?? "Nie udało się zapisać auta." };
  }

  // The plate lives in car_private, not on the public listing row — an
  // approved car is readable by anyone, and RLS filters rows, not columns.
  if (registrationNumber) {
    const { error: privateError } = await supabase
      .from("car_private")
      .upsert({ car_id: car.id, registration_number: registrationNumber });
    if (privateError) {
      // Not fatal for the listing itself, but an admin reviewing this car
      // needs the plate, so make the failure visible rather than silent.
      console.error("createCar: car_private upsert failed", privateError);
      return { error: "Auto zapisane, ale nie udało się zapisać numeru rejestracyjnego. Uzupełnij go w edycji ogłoszenia." , carId: car.id };
    }
  }

  return { error: null, carId: car.id };
}

export async function deleteCarDraft(carId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("cars").delete().eq("id", carId);
}

export async function attachCarImages(
  carId: string,
  images: { path: string; position: number }[],
  insuranceDocumentPath: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (images.length === 0) {
    return { error: "Dodaj przynajmniej jedno zdjęcie auta." };
  }
  if (!insuranceDocumentPath) {
    return { error: "Dodaj polisę OC." };
  }

  const { data: car, error: carFetchError } = await supabase
    .from("cars")
    .select("brand, model, year, price_per_day, city")
    .eq("id", carId)
    .single();

  if (carFetchError || !car) {
    return { error: carFetchError?.message ?? "Nie znaleziono auta." };
  }

  const { error: insuranceError } = await supabase
    .from("car_private")
    .upsert({ car_id: carId, insurance_document_path: insuranceDocumentPath });

  if (insuranceError) {
    return { error: insuranceError.message };
  }

  const { error: imagesError } = await supabase.from("car_images").insert(
    images.map(({ path, position }) => ({
      car_id: carId,
      storage_path: path,
      position,
    }))
  );

  if (imagesError) {
    return { error: imagesError.message };
  }

  const ownerName = String(user.user_metadata?.full_name ?? user.email ?? "nieznany");

  await sendNotificationEmail({
    to: "auto@gomambo.pl",
    subject: `Nowe auto do weryfikacji: ${car.brand} ${car.model}`,
    html: `
      <p>Właściciel dodał nowe auto oczekujące na zatwierdzenie.</p>
      <ul>
        <li><strong>Auto:</strong> ${car.brand} ${car.model} (${car.year})</li>
        <li><strong>Miasto:</strong> ${car.city}</li>
        <li><strong>Cena:</strong> ${Number(car.price_per_day).toFixed(2)} zł/dzień</li>
        <li><strong>Właściciel:</strong> ${ownerName} (${user.email})</li>
      </ul>
      <p><a href="https://www.gomambo.pl/admin/cars">Przejdź do panelu admina</a></p>
    `,
  });

  const admin = createAdminClient();
  await admin.from("admin_notifications").insert({
    type: "new_car_pending",
    body: `Nowe auto do weryfikacji: ${car.brand} ${car.model} — ${ownerName}`,
    link: "/admin/cars",
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
