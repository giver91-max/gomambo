"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { isMaintenanceMode } from "@/lib/maintenance";

export async function approveCar(carId: string) {
  const supabase = await createClient();
  const { data: car, error } = await supabase
    .from("cars")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", carId)
    // status is read BACK on purpose: the catalogue invariant in 0042 can
    // silently force this row to 'paused' when the car belongs to a company
    // that is not active. That is not an error, so without this the owner
    // would be emailed "your car is live" about a car nobody can see.
    .select("owner_id, brand, model, year, status")
    .single();

  if (error) throw new Error(error.message);

  if (car.status !== "approved") {
    throw new Error(
      "Auto należy do wypożyczalni, która nie jest aktywna — zweryfikuj najpierw firmę w zakładce Wypożyczalnie. Ogłoszenie wróci do katalogu automatycznie."
    );
  }

  // While the catalogue is closed, "visible to renters" would be false — and
  // it was the source of "is this working?" from owners who sent the link to
  // friends and got "coming soon". The car does go live by itself on launch.
  const catalogueOpen = !(await isMaintenanceMode());
  const carLabel = `${car.brand} ${car.model} (${car.year})`;
  await notifyUser({
    userId: car.owner_id,
    type: "car_approved",
    subject: `Twoje auto zostało zatwierdzone: ${car.brand} ${car.model}`,
    body: catalogueOpen
      ? `Twoje ogłoszenie ${carLabel} zostało zatwierdzone i jest teraz widoczne dla najemców.`
      : `Twoje ogłoszenie ${carLabel} zostało zatwierdzone. Katalog dla najemców otworzymy wkrótce — auto pojawi się w nim automatycznie. Ustaw już teraz dni dostępności.`,
    emailHtml: catalogueOpen
      ? `
      <p>Dobra wiadomość — Twoje ogłoszenie zostało zatwierdzone i jest teraz widoczne na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
      </ul>
      <p><a href="https://www.gomambo.pl/dashboard">Przejdź do panelu →</a></p>
    `
      : `
      <p>Dobra wiadomość — Twoje ogłoszenie zostało zatwierdzone.</p>
      <ul>
        <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
      </ul>
      <p>Zbieramy teraz auta przed startem, więc katalog dla najemców jest jeszcze zamknięty. Twoje auto pojawi się w nim automatycznie w dniu startu — damy Ci znać mailem.</p>
      <p>Już teraz ustaw w panelu dni, w które auto jest dostępne — wtedy pierwsze rezerwacje mogą przyjść od razu.</p>
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
        <li><strong>Auto:</strong> ${escapeHtml(`${car.brand} ${car.model} (${car.year})`)}</li>
        <li><strong>Powód:</strong> ${escapeHtml(rejectionReason)}</li>
      </ul>
      <p>Popraw ogłoszenie w panelu i kliknij „Wyślij do ponownej weryfikacji”.</p>
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
