"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { isMaintenanceMode } from "@/lib/maintenance";
import { carDocumentsExpired, DOCUMENTS_EXPIRED_REASON } from "@/lib/car-form";
import { getVerificationStatus } from "@/lib/verification-gate";
import { PARTNER_STATUS_LABELS } from "@/lib/partner";
import type { PartnerStatus } from "@/types/database";
import { missingForApproval } from "./approval-gate";

// Every action here returns the problem instead of throwing it: in production
// Next replaces a thrown server-action message with a generic English one,
// and the admin would never learn WHY the car did not go live.

const SESSION_EXPIRED = "Sesja wygasła — zaloguj się ponownie i spróbuj jeszcze raz.";

// An expired session does not fail an update, RLS just matches no row — which
// would read as "the car is gone".
async function sessionClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function approveCar(carId: string): Promise<{ error: string | null }> {
  const supabase = await sessionClient();
  if (!supabase) return { error: SESSION_EXPIRED };

  const { data: current } = await supabase
    .from("cars")
    .select(
      "owner_id, partner_id, status, car_private(registration_number, insurance_document_path, insurance_valid_until, inspection_valid_until, rental_right_confirmed_at), partners(status)"
    )
    .eq("id", carId)
    .maybeSingle();
  if (!current) return { error: "Nie ma takiego auta — mogło zostać usunięte. Odśwież stronę." };
  // Only a car waiting for review: a double click would otherwise mail the
  // owner "approved" twice, and a paused car goes back through "Cofnij do
  // oczekujących" first.
  if (current.status !== "pending") {
    return { error: "To auto nie czeka już na zatwierdzenie — odśwież stronę." };
  }

  // A car whose OC or inspection has run out cannot be published (0051) — the
  // typical case is a paused car whose owner uploaded a new policy but kept
  // the old date. Tell the owner what is missing rather than letting the
  // approval bounce silently.
  if (await carDocumentsExpired(supabase, carId)) {
    const { data: expiredCar } = await supabase
      .from("cars")
      .select("owner_id, brand, model")
      .eq("id", carId)
      .single();
    // Claimed like the daily reminders, so clicking "Zatwierdź" again does
    // not mail the owner again the same day.
    const today = new Date().toISOString().slice(0, 10);
    const { data: claimed } = await supabase
      .from("car_private")
      .update({ documents_reminded_on: today })
      .eq("car_id", carId)
      .or(`documents_reminded_on.is.null,documents_reminded_on.neq.${today}`)
      .select("car_id");
    if (expiredCar && claimed?.length) {
      const label = `${expiredCar.brand} ${expiredCar.model}`;
      await notifyUser({
        userId: expiredCar.owner_id,
        type: "car_documents",
        subject: `Podaj aktualną datę ważności dokumentów: ${label}`,
        body: `Nie możemy zatwierdzić auta ${label}: zapisana data ważności polisy OC albo badania technicznego już minęła. Wpisz aktualną datę w edycji auta.`,
        emailHtml: `
          <p>Nie możemy zatwierdzić auta <strong>${escapeHtml(label)}</strong>: zapisana data ważności polisy OC albo badania technicznego już minęła.</p>
          <p>Wpisz w edycji auta aktualną datę (i dodaj nowy dokument, jeśli jeszcze go nie ma) — wtedy sprawdzimy auto jeszcze raz.</p>
          <p><a href="https://www.gomambo.pl/dashboard/cars/${carId}/edit">Przejdź do edycji auta →</a></p>
        `,
        link: `/dashboard/cars/${carId}/edit`,
      });
    }
    return {
      error:
        "Data ważności OC lub przeglądu tego auta już minęła — poprosiliśmy właściciela o aktualną. Zatwierdzisz auto, gdy ją poda.",
    };
  }

  // Everything a new car is asked for today, and a verified owner or company
  // (see approval-gate.ts). The card greys the button out; this is the rule.
  const priv = (Array.isArray(current.car_private) ? current.car_private[0] : current.car_private) as
    | {
        registration_number: string | null;
        insurance_document_path: string | null;
        insurance_valid_until: string | null;
        inspection_valid_until: string | null;
        rental_right_confirmed_at: string | null;
      }
    | null
    | undefined;
  const partner = current.partners as unknown as { status: PartnerStatus } | null;
  const missing = missingForApproval({
    registrationNumber: priv?.registration_number ?? null,
    insuranceDocumentPath: priv?.insurance_document_path ?? null,
    insuranceValidUntil: priv?.insurance_valid_until ?? null,
    inspectionValidUntil: priv?.inspection_valid_until ?? null,
    rentalRightConfirmedAt: priv?.rental_right_confirmed_at ?? null,
    partner:
      current.partner_id && partner
        ? { status: partner.status, statusLabel: PARTNER_STATUS_LABELS[partner.status] }
        : null,
    ownerVerification: current.partner_id
      ? null
      : (await getVerificationStatus(supabase, current.owner_id)).status,
  });
  if (missing.length > 0) {
    return {
      error: `Nie można jeszcze zatwierdzić — brakuje: ${missing.join(", ")}. Zatwierdzisz auto, gdy wszystko będzie uzupełnione.`,
    };
  }

  const { data: car, error } = await supabase
    .from("cars")
    .update({ status: "approved", rejection_reason: null })
    .eq("id", carId)
    .eq("status", "pending")
    // status is read BACK on purpose: the catalogue invariant in 0042 can
    // silently force this row to 'paused' when the car belongs to a company
    // that is not active. That is not an error, so without this the owner
    // would be emailed "your car is live" about a car nobody can see.
    .select("owner_id, brand, model, year, status, rejection_reason")
    .maybeSingle();

  if (error) return { error: `Nie udało się zatwierdzić auta: ${error.message}` };
  if (!car) return { error: "To auto nie czeka już na zatwierdzenie — odśwież stronę." };

  if (car.status !== "approved" && car.rejection_reason === DOCUMENTS_EXPIRED_REASON) {
    return {
      error:
        "Polisa OC lub badanie techniczne tego auta wygasło — auto zostało wstrzymane. Zatwierdzisz je, gdy właściciel doda aktualny dokument.",
    };
  }
  if (car.status !== "approved") {
    return {
      error:
        "Auto należy do wypożyczalni, która nie jest aktywna — zweryfikuj najpierw firmę w zakładce Wypożyczalnie. Ogłoszenie wróci do katalogu automatycznie.",
    };
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
  return { error: null };
}

export async function rejectCar(
  carId: string,
  reason: string
): Promise<{ error: string | null }> {
  // The owner has to know what to fix; "Brak podanego powodu." used to be
  // mailed when the field was left empty.
  const rejectionReason = reason.trim();
  if (!rejectionReason) {
    return { error: "Napisz powód — właściciel musi wiedzieć, co poprawić." };
  }

  const supabase = await sessionClient();
  if (!supabase) return { error: SESSION_EXPIRED };
  const { data: car, error } = await supabase
    .from("cars")
    .update({ status: "rejected", rejection_reason: rejectionReason })
    .eq("id", carId)
    // Only from review: a double click must not mail the owner twice.
    .eq("status", "pending")
    .select("owner_id, brand, model, year")
    .maybeSingle();

  if (error) return { error: `Nie udało się odrzucić auta: ${error.message}` };
  if (!car) return { error: "To auto nie czeka już na decyzję — odśwież stronę." };

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
  return { error: null };
}

export async function revertCarToPending(carId: string): Promise<{ error: string | null }> {
  const supabase = await sessionClient();
  if (!supabase) return { error: SESSION_EXPIRED };
  const { data: car, error } = await supabase
    .from("cars")
    .update({ status: "pending", rejection_reason: null })
    .eq("id", carId)
    .select("id")
    .maybeSingle();

  if (error) return { error: `Nie udało się cofnąć auta do oczekujących: ${error.message}` };
  if (!car) return { error: "Nie ma takiego auta — mogło zostać usunięte. Odśwież stronę." };
  revalidatePath("/admin/cars");
  revalidatePath("/admin");
  return { error: null };
}
