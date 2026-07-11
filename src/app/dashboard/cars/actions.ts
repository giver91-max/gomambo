"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";

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

  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = Number(formData.get("year"));
  const pricePerDay = Number(formData.get("price_per_day"));
  const city = String(formData.get("city") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!brand || !model || !city) {
    return { error: "Wypełnij markę, model i miasto." };
  }
  if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
    return { error: "Podaj prawidłowy rok produkcji." };
  }
  if (!(pricePerDay > 0)) {
    return { error: "Cena za dzień musi być większa od zera." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "add_car"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const { data: car, error: carError } = await supabase
    .from("cars")
    .insert({
      owner_id: user.id,
      brand,
      model,
      year,
      price_per_day: pricePerDay,
      city,
      description: description || null,
    })
    .select("id")
    .single();

  if (carError || !car) {
    return { error: carError?.message ?? "Nie udało się zapisać auta." };
  }

  return { error: null, carId: car.id };
}

export async function deleteCarDraft(carId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("cars").delete().eq("id", carId);
}

export async function attachCarImages(
  carId: string,
  images: { path: string; position: number }[]
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

  const { data: car, error: carFetchError } = await supabase
    .from("cars")
    .select("brand, model, year, price_per_day, city")
    .eq("id", carId)
    .single();

  if (carFetchError || !car) {
    return { error: carFetchError?.message ?? "Nie znaleziono auta." };
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
      <p><a href="https://www.gomambo.pl/admin">Przejdź do panelu admina</a></p>
    `,
  });

  const admin = createAdminClient();
  await admin.from("admin_notifications").insert({
    type: "new_car_pending",
    body: `Nowe auto do weryfikacji: ${car.brand} ${car.model} — ${ownerName}`,
    link: "/admin",
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
