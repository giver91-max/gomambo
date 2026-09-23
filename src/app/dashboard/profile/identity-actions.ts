"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDocumentLegibility, detectFace } from "@/lib/face-match";
import { assessIdentity, describeAssessment } from "@/lib/identity-gates";

type Slot = "front" | "back" | "selfie";

const SLOTS: Slot[] = ["front", "back", "selfie"];

const SLOT_LABEL: Record<Slot, string> = {
  front: "przód prawa jazdy",
  back: "tył prawa jazdy",
  selfie: "selfie",
};

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The desktop route into identity verification. It collects what the phone
 * route collects — both sides of a driving licence and a live selfie — and
 * runs the same checks, so the device someone happens to be sitting at no
 * longer decides how carefully they are verified. A national ID card is not
 * accepted: renting a car needs a licence, and anything else left the host
 * holding a document that cannot answer the question they have to answer.
 *
 * WHY THE BROWSER STILL UPLOADS THE IMAGES: Vercel hard-caps a serverless
 * request body at ~4.5MB, well under three real phone photos, and the cap is
 * the platform's — next.config's bodySizeLimit does not raise it. Posting the
 * files to this action would have failed with a 413 before the action ran,
 * for exactly the users who photograph their licence properly. The same
 * reasoning is already written down in dashboard/cars/actions.ts for car
 * photos.
 *
 * So the browser uploads, and this action trusts NOTHING it is handed:
 *
 *   - every path must sit under the caller's own user-id prefix, so nobody
 *     can name someone else's file;
 *   - the three images must be three DIFFERENT images, by content hash, not
 *     by path — otherwise a user could upload their licence three times under
 *     three names and have Rekognition compare it with itself for a certain
 *     100%;
 *   - every check (face present, one face on the selfie, legibility, the
 *     comparison, the licence read) runs here on the bytes actually stored,
 *     never on anything the client asserts about them.
 */
export async function submitIdentityVerification(
  paths: { front: string; back: string; selfie: string },
  biometricConsent: boolean
): Promise<{ error: string | null; approved?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The comparison is biometric processing, so it does not happen without a
  // consent the user actually gave.
  if (!biometricConsent) {
    return {
      error:
        "Zaznacz zgodę na porównanie wizerunku — bez niej nie możemy przeprowadzić weryfikacji.",
    };
  }

  const prefix = `${user.id}/`;
  for (const slot of SLOTS) {
    const path = paths[slot];
    if (typeof path !== "string" || !path.startsWith(prefix) || path.includes("..")) {
      return { error: "Nieprawidłowe zdjęcie. Odśwież stronę i spróbuj ponownie." };
    }
  }
  if (new Set(SLOTS.map((s) => paths[s])).size !== SLOTS.length) {
    return { error: "Prześlij trzy różne zdjęcia: przód, tył i selfie." };
  }

  const admin = createAdminClient();

  const buffers = {} as Record<Slot, Buffer>;
  for (const slot of SLOTS) {
    const { data, error } = await admin.storage.from("id-documents").download(paths[slot]);
    if (error || !data) {
      return { error: `Nie udało się odczytać zdjęcia „${SLOT_LABEL[slot]}”. Spróbuj ponownie.` };
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
      return { error: `Zdjęcie „${SLOT_LABEL[slot]}” ma nieprawidłowy rozmiar.` };
    }
    buffers[slot] = buffer;
  }

  // Three paths can still be three copies of one image. Compare the content.
  const hashes = SLOTS.map((slot) =>
    crypto.createHash("sha256").update(buffers[slot]).digest("hex")
  );
  if (new Set(hashes).size !== hashes.length) {
    return {
      error:
        "Te same zdjęcia zostały przesłane więcej niż raz. Potrzebujemy osobnych zdjęć przodu, tyłu i selfie.",
    };
  }

  // Catch an unusable photo now, with the person still at the keyboard,
  // rather than at the end.
  const frontFace = await detectFace(buffers.front, "document");
  if (!frontFace.ok) {
    return {
      error:
        "Nie widać zdjęcia w dokumencie. Upewnij się, że fotografujesz przód prawa jazdy i że zdjęcie jest ostre.",
    };
  }
  const selfieFace = await detectFace(buffers.selfie, "selfie");
  if (!selfieFace.ok) {
    return {
      error:
        selfieFace.reason === "multiple_faces"
          ? "Na selfie widać więcej niż jedną osobę. Zrób zdjęcie ponownie — w kadrze powinna być tylko Twoja twarz."
          : "Nie wykryto wyraźnej twarzy na selfie. Sprawdź oświetlenie i ostrość i spróbuj ponownie.",
    };
  }
  for (const slot of ["front", "back"] as const) {
    const legible = await checkDocumentLegibility(buffers[slot]);
    if (!legible.ok) {
      return {
        error: `Zdjęcie „${SLOT_LABEL[slot]}” jest nieczytelne. Sprawdź oświetlenie i ostrość, upewnij się, że cały dokument jest w kadrze, i spróbuj ponownie.`,
      };
    }
  }

  const assessment = await assessIdentity(buffers.selfie, buffers.front);

  const { data: existing } = await admin
    .from("identity_verifications")
    .select("id, status, rejection_reason, document_path, document_back_path, selfie_path")
    .eq("user_id", user.id)
    .maybeSingle();

  // A human's rejection outranks every automatic gate. Resubmitting after one
  // is supported on purpose — the rejection e-mail asks for it — but the gates
  // cannot see WHY someone was rejected, so the same human looks again.
  const previouslyRejected = existing?.status === "rejected";
  const autoApproved = assessment.passes && !previouslyRejected;

  const row = {
    document_path: paths.front,
    document_back_path: paths.back,
    selfie_path: paths.selfie,
    face_match_score: assessment.match.score,
    face_match_result: assessment.match.result,
    verification_method: "manual" as const,
    biometric_consent_at: new Date().toISOString(),
    status: autoApproved ? ("approved" as const) : ("pending" as const),
    rejection_reason: null,
  };

  if (existing) {
    const { error } = await admin.from("identity_verifications").update(row).eq("id", existing.id);
    if (error) return { error: error.message };
    const stale = [existing.document_path, existing.document_back_path, existing.selfie_path].filter(
      (p): p is string => !!p && !Object.values(paths).includes(p)
    );
    if (stale.length > 0) await admin.storage.from("id-documents").remove(stale);
  } else {
    const { error } = await admin
      .from("identity_verifications")
      .insert({ user_id: user.id, ...row });
    if (error) return { error: error.message };
  }

  if (!autoApproved) {
    const fullName = String(user.user_metadata?.full_name ?? user.email ?? "nieznany");
    const rejected = previouslyRejected
      ? `UWAGA: to konto było wcześniej ODRZUCONE${
          existing?.rejection_reason ? ` (powód: ${existing.rejection_reason})` : ""
        }. `
      : "";
    await admin.from("admin_notifications").insert({
      type: "new_identity_verification",
      body: `${rejected}Nowe zgłoszenie weryfikacji tożsamości: ${fullName}.${describeAssessment(
        assessment
      )}`,
      link: "/admin/verifications",
    });
  }

  revalidatePath("/dashboard/profile");
  return { error: null, approved: autoApproved };
}
