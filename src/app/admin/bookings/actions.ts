"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { cancelBookingWithRefund } from "@/lib/cancellation";
import type { CancellationPolicy } from "@/types/database";

// Same refund/deposit-release rules as the renter's own cancelBooking (see
// src/lib/cancellation.ts) — this just lets admin trigger it on any active
// booking, e.g. to resolve a dispute reported outside the normal flow.
export async function adminCancelBooking(bookingId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: "Brak uprawnień." };
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `renter_id, owner_id, status, start_date, end_date,
       payment_status, stripe_checkout_session_id, deposit_status, stripe_deposit_payment_intent_id,
       cars(brand, model, year, cancellation_policy)`
    )
    .eq("id", bookingId)
    .single();

  if (!booking) {
    return { error: "Nie znaleziono rezerwacji." };
  }
  if (booking.status !== "requested" && booking.status !== "accepted") {
    return { error: "Można anulować tylko aktywną rezerwację." };
  }

  const policy: CancellationPolicy =
    (booking.cars as unknown as { cancellation_policy: CancellationPolicy } | null)
      ?.cancellation_policy ?? "moderate";
  await cancelBookingWithRefund(admin, bookingId, {
    start_date: booking.start_date,
    payment_status: booking.payment_status,
    stripe_checkout_session_id: booking.stripe_checkout_session_id,
    deposit_status: booking.deposit_status,
    stripe_deposit_payment_intent_id: booking.stripe_deposit_payment_intent_id,
    cancellation_policy: policy,
  });

  const car = booking.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
  const period = `${booking.start_date} – ${booking.end_date}`;

  await Promise.all([
    notifyUser({
      userId: booking.owner_id,
      type: "booking_cancelled",
      subject: `Rezerwacja anulowana: ${carLabel}`,
      body: `Administrator anulował rezerwację ${carLabel} (${period}).`,
      emailHtml: `
        <p>Administrator GoMambo anulował tę rezerwację.</p>
        <ul>
          <li><strong>Auto:</strong> ${carLabel}</li>
          <li><strong>Termin:</strong> ${period}</li>
        </ul>
        <p><a href="https://www.gomambo.pl/dashboard/bookings">Zobacz rezerwacje →</a></p>
      `,
      link: "/dashboard/bookings",
    }),
    notifyUser({
      userId: booking.renter_id,
      type: "booking_cancelled",
      subject: `Rezerwacja anulowana: ${carLabel}`,
      body: `Administrator anulował Twoją rezerwację ${carLabel} (${period}).`,
      emailHtml: `
        <p>Administrator GoMambo anulował tę rezerwację.</p>
        <ul>
          <li><strong>Auto:</strong> ${carLabel}</li>
          <li><strong>Termin:</strong> ${period}</li>
        </ul>
        <p><a href="https://www.gomambo.pl/dashboard/rentals">Zobacz rezerwacje →</a></p>
      `,
      link: "/dashboard/rentals",
    }),
  ]);

  revalidatePath("/admin/bookings");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
