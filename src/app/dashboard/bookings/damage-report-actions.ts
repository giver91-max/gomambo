"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { sendNotificationEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import { escapeHtml } from "@/lib/html";

const ADMIN_ALERT_EMAIL = "user@gomambo.pl";
const MAX_DESCRIPTION = 4000;

/**
 * A problem with a rental, filed by either side. Goes to BOTH the other
 * party and GoMambo — the owner's own charge flow (extra charges, deposit
 * capture) only ever pointed one way and left us with nothing to act on.
 *
 * Written with the service role: damage_reports has no client insert policy
 * on purpose, so nobody can file a report in the other side's name.
 */
export async function reportDamage(
  bookingId: string,
  description: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const trimmed = description.trim();
  if (!trimmed) {
    return { error: "Opisz, co się stało." };
  }
  if (trimmed.length > MAX_DESCRIPTION) {
    return { error: "Opis jest za długi — zmieść się w 4000 znakach." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, owner_id, renter_id, start_date, end_date, status, cars(brand, model, year)")
    .eq("id", bookingId)
    .single();

  if (!booking || (booking.owner_id !== user.id && booking.renter_id !== user.id)) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  // A report only makes sense once the car has actually changed hands.
  if (booking.status !== "accepted" && booking.status !== "completed") {
    return { error: "Zgłoszenie można wysłać tylko dla trwającego lub zakończonego wynajmu." };
  }

  const isOwner = booking.owner_id === user.id;
  const counterpartyId = isOwner ? booking.renter_id : booking.owner_id;
  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  // Plain text for the in-app notification, escaped for the two emails: an
  // owner types brand and model themselves.
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  const carLabelHtml = escapeHtml(carLabel);

  const admin = createAdminClient();
  const { data: report, error } = await admin
    .from("damage_reports")
    .insert({
      booking_id: bookingId,
      reporter_id: user.id,
      reporter_role: isOwner ? "owner" : "renter",
      description: trimmed,
    })
    .select("id")
    .single();

  if (error || !report) {
    return { error: error?.message ?? "Nie udało się wysłać zgłoszenia." };
  }

  const who = isOwner ? "Właściciel" : "Najemca";
  // The counterparty is the OTHER side: if the owner filed, the renter reads
  // this, and the renter's bookings live on /dashboard/rentals.
  const counterpartyPath = isOwner ? "/dashboard/rentals" : "/dashboard/bookings";
  const period = `${booking.start_date} – ${booking.end_date}`;

  await notifyUser({
    userId: counterpartyId,
    type: "damage_reported",
    subject: `Zgłoszenie do wynajmu: ${carLabel}`,
    body: `${who} zgłosił problem z wynajmem ${carLabel} (${period}). GoMambo też dostało to zgłoszenie.`,
    emailHtml: `
      <p>${who} zgłosił problem dotyczący wynajmu na GoMambo.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabelHtml}</li>
        <li><strong>Termin:</strong> ${period}</li>
      </ul>
      <p><strong>Opis zgłoszenia:</strong></p>
      <p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>
      <p>To samo zgłoszenie trafiło do obsługi GoMambo — odezwiemy się, jeśli będzie potrzebna nasza decyzja.</p>
      <p><a href="${SITE_URL}${counterpartyPath}">Zobacz rezerwację →</a></p>
    `,
    link: counterpartyPath,
  });

  // Second channel, on purpose: the in-app queue is what an admin works
  // through day to day, the email is what reaches someone out of hours.
  const { error: adminNotifyError } = await admin.from("admin_notifications").insert({
    type: "damage_reported",
    body: `${who} zgłosił problem z wynajmem ${carLabel} (${period}). Rezerwacja ${bookingId}.`,
    link: "/admin/zgloszenia",
  });
  if (adminNotifyError) {
    console.error("[damage-report] admin notification insert failed", adminNotifyError);
  }

  await sendNotificationEmail({
    to: ADMIN_ALERT_EMAIL,
    subject: `Zgłoszenie do wynajmu: ${carLabel}`,
    html: `
      <p><strong>${who}</strong> zgłosił problem z wynajmem.</p>
      <ul>
        <li><strong>Auto:</strong> ${carLabelHtml}</li>
        <li><strong>Termin:</strong> ${period}</li>
        <li><strong>Rezerwacja:</strong> ${bookingId}</li>
      </ul>
      <p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>
      <p><a href="${SITE_URL}/admin/zgloszenia">Otwórz zgłoszenia →</a></p>
    `,
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  revalidatePath("/admin/zgloszenia");
  return { error: null };
}
