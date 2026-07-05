"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendNotificationEmail } from "@/lib/email";

export type CarFormState = { error: string | null };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 8;

export async function createCar(
  _prevState: CarFormState,
  formData: FormData
): Promise<CarFormState> {
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

  if (!brand || !model || !city) {
    return { error: "Wypełnij markę, model i miasto." };
  }
  if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
    return { error: "Podaj prawidłowy rok produkcji." };
  }
  if (!(pricePerDay > 0)) {
    return { error: "Cena za dzień musi być większa od zera." };
  }

  const images = formData
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (images.length === 0) {
    return { error: "Dodaj przynajmniej jedno zdjęcie auta." };
  }
  if (images.length > MAX_IMAGES) {
    return { error: `Maksymalnie ${MAX_IMAGES} zdjęć.` };
  }
  for (const image of images) {
    if (!image.type.startsWith("image/")) {
      return { error: `Plik "${image.name}" nie jest zdjęciem.` };
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return { error: `Zdjęcie "${image.name}" przekracza 5 MB.` };
    }
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

  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const ext = image.name.split(".").pop() || "jpg";
    const path = `${user.id}/${car.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("car-images")
      .upload(path, image, { contentType: image.type });

    if (uploadError) {
      return { error: `Błąd wgrywania zdjęcia: ${uploadError.message}` };
    }

    const { error: imageRowError } = await supabase.from("car_images").insert({
      car_id: car.id,
      storage_path: path,
      position: index,
    });

    if (imageRowError) {
      return { error: imageRowError.message };
    }
  }

  const ownerName = String(user.user_metadata?.full_name ?? user.email ?? "nieznany");

  await sendNotificationEmail({
    to: "auto@gomambo.pl",
    subject: `Nowe auto do weryfikacji: ${brand} ${model}`,
    html: `
      <p>Właściciel dodał nowe auto oczekujące na zatwierdzenie.</p>
      <ul>
        <li><strong>Auto:</strong> ${brand} ${model} (${year})</li>
        <li><strong>Miasto:</strong> ${city}</li>
        <li><strong>Cena:</strong> ${pricePerDay.toFixed(2)} zł/dzień</li>
        <li><strong>Właściciel:</strong> ${ownerName} (${user.email})</li>
      </ul>
      <p><a href="https://www.gomambo.pl/admin">Przejdź do panelu admina</a></p>
    `,
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
