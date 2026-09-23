"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { SITE_URL } from "@/lib/site";
import { requestVerificationIfDue } from "@/lib/booking-verification";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }
  return createAdminClient();
}

/**
 * The money arrived on the bank account — this is what actually marks the
 * booking paid. Guarded on payment_status so a double click (or two admins)
 * can't notify the owner twice.
 */
export async function confirmBookingTransfer(bookingId: string): Promise<{ error: string | null }> {
  const admin = await requireAdmin();

  const { data: booking, error } = await admin
    .from("bookings")
    .update({ payment_status: "paid" })
    .eq("id", bookingId)
    .eq("payment_status", "unpaid")
    .eq("payment_method", "bank_transfer")
    // Re-checked here and not just in the listing query: the booking can be
    // cancelled between the page render and this click. 'completed' stays
    // confirmable — the trip is over but the money is still owed.
    .in("status", ["accepted", "completed"])
    .select("owner_id, total_price, cars(brand, model)")
    .single();

  if (error || !booking) {
    return { error: "Nie udało się potwierdzić — odśwież stronę i sprawdź, czy rezerwacja nie została anulowana albo wpłata już zaksięgowana." };
  }

  // Same reason as the Stripe path: the booking only becomes real here.
  await requestVerificationIfDue(admin, bookingId);

  const car = booking.cars as unknown as { brand: string; model: string } | null;
  const label = car ? `${car.brand} ${car.model}` : "auto";
  await notifyUser({
    userId: booking.owner_id,
    type: "booking_paid",
    subject: "Płatność za wynajem otrzymana",
    body: `Najemca opłacił wynajem ${label} przelewem. Rezerwacja jest potwierdzona.`,
    emailHtml: `
      <p>Najemca opłacił rezerwację przelewem bankowym — ${label}.</p>
      <p>Kwota: ${booking.total_price ? Number(booking.total_price).toFixed(2) : "?"} zł.</p>
      <p><a href="${SITE_URL}/dashboard/bookings">Przejdź do rezerwacji →</a></p>
    `,
    link: "/dashboard/bookings",
  });

  revalidatePath("/admin/przelewy");
  revalidatePath("/dashboard/rentals");
  revalidatePath("/dashboard/bookings");
  return { error: null };
}

export async function confirmExtraChargeTransfer(
  extraChargeId: string
): Promise<{ error: string | null }> {
  const admin = await requireAdmin();

  const { data: extraCharge, error } = await admin
    .from("booking_extra_charges")
    .update({ status: "paid" })
    .eq("id", extraChargeId)
    .eq("status", "requested")
    .eq("payment_method", "bank_transfer")
    .select("amount_pln, reason, bookings(owner_id, status, cars(brand, model))")
    .single();

  if (error || !extraCharge) {
    return { error: "Nie udało się potwierdzić — odśwież stronę i sprawdź, czy wpłata nie była już zaksięgowana." };
  }

  const chargeBooking = extraCharge.bookings as unknown as {
    owner_id: string;
    status: string;
    cars: { brand: string; model: string } | null;
  } | null;
  if (chargeBooking && chargeBooking.status !== "accepted" && chargeBooking.status !== "completed") {
    // Cancelled between the page render and this click. The charge is marked
    // paid either way (the money did arrive) — but say so plainly instead of
    // telling the owner a dead rental was settled.
    return {
      error:
        "Rezerwacja została w międzyczasie anulowana — dopłatę oznaczyliśmy jako opłaconą, ale zwrot ustal ręcznie.",
    };
  }
  if (chargeBooking) {
    const label = chargeBooking.cars
      ? `${chargeBooking.cars.brand} ${chargeBooking.cars.model}`
      : "auto";
    await notifyUser({
      userId: chargeBooking.owner_id,
      type: "extra_charge_requested",
      subject: `Dopłata opłacona: ${label}`,
      body: `Najemca opłacił przelewem dopłatę ${Number(extraCharge.amount_pln).toFixed(2)} zł za ${label} (${extraCharge.reason}).`,
      emailHtml: `
        <p>Najemca opłacił przelewem zgłoszoną przez Ciebie dopłatę.</p>
        <ul>
          <li><strong>Auto:</strong> ${label}</li>
          <li><strong>Kwota:</strong> ${Number(extraCharge.amount_pln).toFixed(2)} zł</li>
          <li><strong>Powód:</strong> ${extraCharge.reason}</li>
        </ul>
        <p><a href="${SITE_URL}/dashboard/bookings">Zobacz rezerwacje →</a></p>
      `,
      link: "/dashboard/bookings",
    });
  }

  revalidatePath("/admin/przelewy");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
