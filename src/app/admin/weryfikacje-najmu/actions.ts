"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify-user";
import { SITE_URL } from "@/lib/site";
import { sendPickupInstructionsIfDue } from "@/lib/pickup-instructions";

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
  return { admin: createAdminClient(), userId: user.id };
}

/**
 * GoMambo's call on a verification the owner wouldn't confirm, the automatic
 * comparison couldn't settle, or nobody acted on in time. Approving here is
 * what releases the pickup instructions; it deliberately does NOT cancel the
 * booking, which stays the owner's own decision via ownerCancelBooking.
 */
export async function resolveBookingVerification(
  bookingId: string,
  decision: "approve" | "keep_blocked",
  note: string
): Promise<{ error: string | null }> {
  const { admin, userId } = await requireAdmin();

  const { data: booking } = await admin
    .from("bookings")
    .select("renter_id, cars(brand, model, year)")
    .eq("id", bookingId)
    .single();
  const car = booking?.cars as unknown as { brand: string; model: string; year: number } | null;
  const carLabel = car ? `${car.brand} ${car.model} (${car.year})` : "auto";

  const trimmed = note.trim();

  if (decision === "keep_blocked") {
    const { error } = await admin
      .from("booking_verifications")
      .update({ decided_at: new Date().toISOString(), decided_by: userId })
      .eq("booking_id", bookingId)
      .neq("status", "approved");
    if (error) return { error: error.message };
    // Internal note, on the admin-only table — never on the row both the
    // renter and the owner can read.
    if (trimmed) {
      await admin
        .from("booking_verification_notes")
        .upsert({ booking_id: bookingId, reason: `Decyzja GoMambo: wstrzymane. ${trimmed}` });
    }
    revalidatePath("/admin/weryfikacje-najmu");
    return { error: null };
  }

  const { data: approved } = await admin
    .from("booking_verifications")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: userId,
    })
    .eq("booking_id", bookingId)
    // "Admin zawsze" — GoMambo can confirm a verification at any stage, not
    // only one that was escalated to it.
    .neq("status", "approved")
    .select("booking_id")
    .maybeSingle();

  if (!approved) {
    return { error: "Nie ma czego zatwierdzać — odśwież stronę." };
  }

  await admin.from("booking_verification_notes").upsert({
    booking_id: bookingId,
    reason: trimmed ? `Zatwierdzone przez GoMambo. ${trimmed}` : "Zatwierdzone przez GoMambo.",
  });

  if (booking) {
    await notifyUser({
      userId: booking.renter_id,
      type: "booking_verification_approved",
      subject: `Potwierdzone — odbierasz ${carLabel}`,
      body: "Sprawdziliśmy wszystko i potwierdzamy Twoją rezerwację. Dane do odbioru wyślemy dzień przed terminem.",
      emailHtml: `
        <p>Sprawdziliśmy wszystko — Twoja rezerwacja jest potwierdzona.</p>
        <p>Numer rejestracyjny, miejsce odbioru i kontakt do właściciela wyślemy dzień przed terminem.</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
      `,
      link: "/dashboard/rentals",
    });
  }

  // Same reason as the owner's approve path: the daily job only looks at
  // trips starting today or tomorrow, so an approval made after it ran must
  // release the instructions itself.
  await sendPickupInstructionsIfDue(admin, bookingId);

  revalidatePath("/admin/weryfikacje-najmu");
  revalidatePath("/dashboard/rentals");
  revalidatePath("/dashboard/bookings");
  return { error: null };
}
