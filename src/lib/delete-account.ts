import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DEPOSIT_HELD_STATES } from "@/lib/deposit";

// What a company is set to when it cannot be deleted with its last member
// (see below). The company sees nothing — it has no members left — so this
// is for the admin reading /admin/partnerzy.
const ORPHANED_PARTNER_REASON =
  "Konto ostatniej osoby w firmie zostało usunięte — współpraca zakończona automatycznie.";

/**
 * Every object stored under `prefix/` in a bucket. Both buckets this is used
 * for keep their files flat under one owner folder, but storage policies only
 * check the first path segment, so a hand-made upload could nest deeper —
 * folders are followed too, a few levels down. Paged: list() returns at most
 * `limit` entries per call.
 */
async function listAllUnder(
  admin: SupabaseClient<Database>,
  bucket: string,
  prefix: string,
  depth = 0
): Promise<string[]> {
  const PAGE = 1000;
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) {
      console.error("[delete-account] could not list storage folder", { bucket, prefix, message: error.message });
      break;
    }
    for (const item of data ?? []) {
      if (item.id) {
        paths.push(`${prefix}/${item.name}`);
      } else if (depth < 3) {
        // A folder entry has no id.
        paths.push(...(await listAllUnder(admin, bucket, `${prefix}/${item.name}`, depth + 1)));
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return paths;
}

/** remove() takes a bounded list per call; an account rarely has many files. */
async function removeAll(admin: SupabaseClient<Database>, bucket: string, paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths));
  for (let i = 0; i < unique.length; i += 1000) {
    const { error } = await admin.storage.from(bucket).remove(unique.slice(i, i + 1000));
    if (error) {
      console.error("[delete-account] storage remove failed", { bucket, message: error.message });
    }
  }
}

// Shared by admin-triggered deletion (admin/users/actions.ts) and
// self-service deletion (dashboard/profile/delete-account-actions.ts).
// Deletes the auth.users row, which cascades through profiles to every
// related table (cars, bookings, conversations, messages, reviews, trip
// photos, notifications, identity verifications...) per migration 0027.
// Storage objects aren't relationally enforced, so they're purged
// explicitly first — otherwise avatars, ID documents, car photos, and
// insurance/trip photos would leak in Storage after the DB rows are gone.
// A rental company whose only member this account was is removed right
// after the account itself (see the end of the function).
export async function purgeUserDataAndDeleteAccount(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<{ error: string | null }> {
  const [{ data: profile }, { data: verification }, { data: handoffs }, { data: cars }, { data: ownerBookings }, { data: renterBookings }, { data: memberships }] =
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
      admin
        .from("cars")
        .select("id, car_private(insurance_document_path)")
        .eq("owner_id", userId),
      admin.from("bookings").select("id").eq("owner_id", userId),
      admin.from("bookings").select("id").eq("renter_id", userId),
      admin.from("partner_members").select("partner_id").eq("profile_id", userId),
    ]);

  // Face photos taken before each pickup live in the same private bucket.
  // The rows cascade away with the bookings, which is exactly why the files
  // have to be collected BEFORE anything is deleted — afterwards nothing
  // points at them and they would sit there indefinitely.
  const { data: bookingSelfies } = await admin
    .from("booking_verifications")
    .select("selfie_path, bookings!inner(renter_id)")
    .eq("bookings.renter_id", userId)
    .not("selfie_path", "is", null);

  // A deposit GoMambo still holds (or still owes back) must be settled
  // first. The database refuses the delete anyway (0052,
  // prevent_open_deposit_delete) — checked here, before any file is removed,
  // so a refused deletion does not leave the account without its photos.
  const allBookingIds = [...(ownerBookings ?? []), ...(renterBookings ?? [])].map((b) => b.id);
  if (allBookingIds.length > 0) {
    const { data: openDeposits, error: depositError } = await admin
      .from("booking_deposits")
      .select("booking_id")
      .in("booking_id", allBookingIds)
      .or(`status.in.(processing,${DEPOSIT_HELD_STATES.join(",")}),refund_status.in.(pending,failed)`)
      .limit(1);
    if (depositError) {
      return { error: "Nie udało się sprawdzić kaucji tego konta. Spróbuj ponownie za chwilę." };
    }
    if ((openDeposits ?? []).length > 0) {
      return {
        error:
          "Na tym koncie jest kaucja, która nie została jeszcze rozliczona. Konto można usunąć po jej zwrocie lub rozliczeniu — napisz do nas, jeśli potrzebujesz pomocy.",
      };
    }
  }

  // The rows only point at the photos of the attempt that was saved. A
  // verification that failed half-way (no face found, unreadable, a dropped
  // connection) leaves its uploads behind with no row at all, and the privacy
  // policy (§5) promises every ID photo is gone once the account is. Every
  // upload path starts with the user's id, so the whole folder is removed —
  // the row paths are kept in the list in case one ever lived elsewhere.
  const idDocumentPaths = [
    verification?.document_path,
    verification?.document_back_path,
    verification?.selfie_path,
    ...(handoffs ?? []).flatMap((h) => [h.document_front_path, h.document_back_path, h.selfie_path]),
    ...(bookingSelfies ?? []).map((v) => v.selfie_path),
    ...(await listAllUnder(admin, "id-documents", userId)),
  ].filter((path): path is string => !!path);
  if (idDocumentPaths.length > 0) {
    await removeAll(admin, "id-documents", idDocumentPaths);
  }

  // Companies this account is the ONLY member of. The cascade would remove
  // just the membership and leave the company — NIP, address, registration
  // documents (personal data for a sole trader) — in the admin's queue with
  // "Osoby w firmie: —", one click away from being activated with nobody
  // behind it. Collected now, while partner_members still says who belongs
  // where; acted on only after the account is really gone (below), so a
  // refused deletion leaves the company untouched.
  const partnerIds = Array.from(new Set((memberships ?? []).map((m) => m.partner_id)));
  const soleCompanies: { partnerId: string; documentPaths: string[] }[] = [];
  if (partnerIds.length > 0) {
    const { data: allMembers, error: membersError } = await admin
      .from("partner_members")
      .select("partner_id, profile_id")
      .in("partner_id", partnerIds);
    if (membersError) {
      console.error("[delete-account] could not read company members", membersError);
    }
    for (const partnerId of partnerIds) {
      const others = (allMembers ?? []).filter((m) => m.partner_id === partnerId && m.profile_id !== userId);
      // On a read error nobody counts as sole: leaving a company in place is
      // recoverable, deleting one that still has members is not.
      if (membersError || others.length > 0) continue;
      const { data: documents } = await admin
        .from("partner_documents")
        .select("storage_path")
        .eq("partner_id", partnerId);
      soleCompanies.push({
        partnerId,
        documentPaths: [
          ...(documents ?? []).map((d) => d.storage_path),
          // Uploads whose partner_documents insert never happened.
          ...(await listAllUnder(admin, "partner-documents", partnerId)),
        ],
      });
    }
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
    const carPrivate = car.car_private as unknown as {
      insurance_document_path: string | null;
    } | null;
    if (carPrivate?.insurance_document_path) {
      await admin.storage.from("car-insurance").remove([carPrivate.insurance_document_path]);
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
    // GoTrue's own text is English and meant for a developer.
    console.error("[delete-account] deleteUser failed", { userId, code: error.code, message: error.message });
    return { error: "Nie udało się usunąć konta. Spróbuj ponownie za chwilę albo napisz do nas: kontakt@gomambo.pl." };
  }

  // The account is gone, and with it (cascade) its cars, so nothing of this
  // person's still references the company. Deleting it takes
  // partner_private, partner_documents and partner_members with it (0042),
  // the same full cascade an account gets (0027). Should another account's
  // car still point at it (cars.partner_id is RESTRICT), the company is
  // ended instead: 'terminated' takes it out of the verification queue, and
  // the sync_partner_fleet_status trigger pauses any approved car of it.
  // Failures here are logged, never returned — the account deletion the
  // caller asked for has already happened.
  for (const { partnerId, documentPaths } of soleCompanies) {
    try {
      const { error: deleteError } = await admin.from("partners").delete().eq("id", partnerId);
      if (!deleteError) {
        if (documentPaths.length > 0) await removeAll(admin, "partner-documents", documentPaths);
        continue;
      }
      console.error("[delete-account] could not delete orphaned company, ending it instead", {
        partnerId,
        code: deleteError.code,
        message: deleteError.message,
      });
      const { error: endError } = await admin
        .from("partners")
        .update({ status: "terminated", rejection_reason: ORPHANED_PARTNER_REASON })
        .eq("id", partnerId);
      if (endError) {
        console.error("[delete-account] could not end orphaned company", { partnerId, message: endError.message });
      }
    } catch (partnerError) {
      console.error("[delete-account] orphaned company cleanup threw", { partnerId, partnerError });
    }
  }

  return { error: null };
}
