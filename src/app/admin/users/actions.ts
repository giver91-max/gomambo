"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateAdminConversation } from "@/lib/admin-chat";

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

  const [{ data: profile }, { data: verification }, { data: handoffs }, { data: cars }, { data: ownerBookings }, { data: renterBookings }] =
    await Promise.all([
      admin.from("profiles").select("avatar_path").eq("id", userId).single(),
      admin
        .from("identity_verifications")
        .select("document_path, document_back_path, selfie_path")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("identity_verification_handoffs")
        .select("document_front_path, document_back_path, selfie_path")
        .eq("user_id", userId),
      admin.from("cars").select("id, insurance_document_path").eq("owner_id", userId),
      admin.from("bookings").select("id").eq("owner_id", userId),
      admin.from("bookings").select("id").eq("renter_id", userId),
    ]);

  const idDocumentPaths = [
    verification?.document_path,
    verification?.document_back_path,
    verification?.selfie_path,
    ...(handoffs ?? []).flatMap((h) => [h.document_front_path, h.document_back_path, h.selfie_path]),
  ].filter((path): path is string => !!path);
  if (idDocumentPaths.length > 0) {
    await admin.storage.from("id-documents").remove(idDocumentPaths);
  }

  if (profile?.avatar_path) {
    await admin.storage.from("avatars").remove([profile.avatar_path]);
  }

  for (const car of cars ?? []) {
    const { data: images } = await admin.from("car_images").select("storage_path").eq("car_id", car.id);
    const imagePaths = (images ?? []).map((i) => i.storage_path);
    if (imagePaths.length > 0) {
      await admin.storage.from("car-images").remove(imagePaths);
    }
    if (car.insurance_document_path) {
      await admin.storage.from("car-insurance").remove([car.insurance_document_path]);
    }
  }

  const bookingIds = [...(ownerBookings ?? []), ...(renterBookings ?? [])].map((b) => b.id);
  if (bookingIds.length > 0) {
    const { data: tripPhotos } = await admin.from("trip_photos").select("storage_path").in("booking_id", bookingIds);
    const tripPhotoPaths = (tripPhotos ?? []).map((p) => p.storage_path);
    if (tripPhotoPaths.length > 0) {
      await admin.storage.from("trip-photos").remove(tripPhotoPaths);
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}
