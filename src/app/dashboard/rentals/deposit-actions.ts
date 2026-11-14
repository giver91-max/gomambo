"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { objectToRetention } from "@/lib/deposit-service";

const MAX_OBJECTION = 2000;

/**
 * The renter's "Nie zgadzam się" with a kept part of the deposit. Stops the
 * transfer to the owner and puts the case in front of GoMambo. Only within
 * the objection window — objectToRetention claims it on the deadline, so a
 * click racing the daily job either wins or is told it came too late.
 */
export async function objectDepositRetention(
  bookingId: string,
  comment: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const trimmed = comment.trim();
  if (!trimmed) {
    return { error: "Napisz, dlaczego się nie zgadzasz — GoMambo przeczyta to przed decyzją." };
  }
  if (trimmed.length > MAX_OBJECTION) {
    return { error: `Opis jest za długi — zmieść się w ${MAX_OBJECTION} znakach.` };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("renter_id")
    .eq("id", bookingId)
    .single();
  if (!booking || booking.renter_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }

  const result = await objectToRetention(createAdminClient(), bookingId, {
    renterId: user.id,
    comment: trimmed,
  });
  if (result.error) return result;

  revalidatePath("/dashboard/rentals");
  revalidatePath("/dashboard/bookings");
  return { error: null };
}
