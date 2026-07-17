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
