"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";

export async function approveCar(carId: string) {
  const supabase = await createClient();
  const { data: car, error } = await supabase
    .from("cars")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", carId)
    .select("owner_id, brand, model, year")
    .single();

  if (error) throw new Error(error.message);

  await notifyUser({
    userId: car.owner_id,
    type: "car_approved",
    subject: `Twoje auto zostało zatwierdzone: ${car.brand} ${car.model}`,
    body: `Twoje ogłoszenie ${car.brand} ${car.model} (${car.year}) zostało zatwierdzone i jest teraz widoczne dla najemców.`,
    emailHtml: `
      <p>Dobra wiadomość — Twoje ogłoszenie zostało zatwierdzone i jest teraz widoczne na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${car.brand} ${car.model} (${car.year})</li>
      </ul>
      <p><a href="https://www.gomambo.pl/dashboard">Przejdź do panelu →</a></p>
    `,
  });

  revalidatePath("/admin/cars");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function rejectCar(carId: string, reason: string) {
  const supabase = await createClient();
  const rejectionReason = reason || "Brak podanego powodu.";
  const { data: car, error } = await supabase
    .from("cars")
    .update({ status: "rejected", rejection_reason: rejectionReason })
    .eq("id", carId)
    .select("owner_id, brand, model, year")
    .single();

  if (error) throw new Error(error.message);

  await notifyUser({
    userId: car.owner_id,
    type: "car_rejected",
    subject: `Twoje auto wymaga poprawek: ${car.brand} ${car.model}`,
    body: `Twoje ogłoszenie ${car.brand} ${car.model} (${car.year}) zostało odrzucone. Powód: ${rejectionReason}`,
    emailHtml: `
      <p>Twoje ogłoszenie na GoMambo nie zostało zatwierdzone.</p>
      <ul>
        <li><strong>Auto:</strong> ${car.brand} ${car.model} (${car.year})</li>
        <li><strong>Powód:</strong> ${rejectionReason}</li>
      </ul>
      <p>Popraw ogłoszenie i wyślij je do ponownej weryfikacji.</p>
      <p><a href="https://www.gomambo.pl/dashboard">Przejdź do panelu →</a></p>
    `,
  });

  revalidatePath("/admin/cars");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function revertCarToPending(carId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("cars")
    .update({ status: "pending", rejection_reason: null })
    .eq("id", carId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/cars");
  revalidatePath("/admin");
}
