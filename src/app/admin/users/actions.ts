"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateAdminConversation } from "@/lib/admin-chat";
import { purgeUserDataAndDeleteAccount } from "@/lib/delete-account";

export async function startConversationWithUser(userId: string) {
  const supabase = await createClient();
  const conversationId = await getOrCreateAdminConversation(supabase, userId);
  if (!conversationId) {
    throw new Error("Nie udało się utworzyć wątku.");
  }
  redirect(`/admin/messages/${conversationId}`);
}

// Deletes the auth.users row, which cascades through profiles to every
// related table (cars, bookings, conversations, messages, reviews, trip
// photos, notifications, identity verifications...) per migration 0027.
// Storage objects aren't relationally enforced, so they're purged
// explicitly first — otherwise avatars, ID documents, car photos, and
// insurance/trip photos would leak in Storage after the DB rows are gone.
export async function deleteUserAccount(userId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  if (!currentUser) redirect("/login");

  if (currentUser.id === userId) {
    return { error: "Nie możesz usunąć własnego konta." };
  }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", currentUser.id).single();
  if (callerProfile?.role !== "admin") {
    return { error: "Brak uprawnień." };
  }

  const admin = createAdminClient();
  const { error } = await purgeUserDataAndDeleteAccount(admin, userId);
  if (error) {
    return { error };
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

// Percent in the form (0–100), fraction in the DB. An empty rate removes the
// override row (back to the platform default). The optional date means
// "through the end of that day" (stored as 23:59:59 UTC — an hour or two of
// slack on a months-long promo is irrelevant, and it avoids DST arithmetic).
// Written with the service-role client: owner_commission_overrides has no
// write policy for anyone else.
export async function setOwnerCommission(userId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  if (!currentUser) redirect("/login");

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", currentUser.id)
    .single();
  if (callerProfile?.role !== "admin") {
    redirect(`/admin/users/${userId}?commission=forbidden`);
  }

  const rateRaw = String(formData.get("ratePercent") ?? "").trim().replace(",", ".");
  const untilRaw = String(formData.get("until") ?? "").trim();
  const admin = createAdminClient();

  if (rateRaw === "") {
    const { error } = await admin.from("owner_commission_overrides").delete().eq("owner_id", userId);
    revalidatePath(`/admin/users/${userId}`);
    redirect(`/admin/users/${userId}?commission=${error ? "error" : "saved"}`);
  }

  const percent = Number(rateRaw);
  // Strictly below 100: Stripe requires the application fee to be less than
  // the charge amount, and a 100% rate would net the owner nothing anyway.
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
    redirect(`/admin/users/${userId}?commission=invalid`);
  }
  const commissionRate = Math.round(percent * 100) / 10000;

  let commissionRateUntil: string | null = null;
  if (untilRaw !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(untilRaw)) {
      redirect(`/admin/users/${userId}?commission=invalid`);
    }
    const until = new Date(`${untilRaw}T23:59:59Z`);
    // V8 rolls impossible days over (2026-02-31 -> 03-03) instead of
    // returning Invalid Date, so require the parsed date to round-trip.
    if (Number.isNaN(until.getTime()) || until.toISOString().slice(0, 10) !== untilRaw) {
      redirect(`/admin/users/${userId}?commission=invalid`);
    }
    commissionRateUntil = until.toISOString();
  }

  const { error } = await admin.from("owner_commission_overrides").upsert(
    {
      owner_id: userId,
      commission_rate: commissionRate,
      commission_rate_until: commissionRateUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" }
  );

  revalidatePath(`/admin/users/${userId}`);
  redirect(`/admin/users/${userId}?commission=${error ? "error" : "saved"}`);
}
