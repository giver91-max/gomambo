"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { compareFaces } from "@/lib/face-match";
import { notifyUser } from "@/lib/notify-user";
import { escapeHtml } from "@/lib/html";
import { SITE_URL } from "@/lib/site";
import { sendPickupInstructionsIfDue } from "@/lib/pickup-instructions";
import { raiseToGoMambo } from "@/lib/booking-verification";
import type { FaceMatchResult } from "@/types/database";

const MAX_SELFIE_BYTES = 8 * 1024 * 1024;

function carLabelOf(car: { brand: string; model: string; year: number } | null): string {
  return car ? `${car.brand} ${car.model} (${car.year})` : "auto";
}

/**
 * The renter's fresh selfie for one booking, compared against the identity
 * document an admin already approved. The risk this catches is an account
 * handed to someone else after sign-up, so the document itself is not
 * re-collected.
 *
 * The IMAGE is uploaded here rather than by the browser, and the storage path
 * is chosen here too. An earlier version took a client-supplied path and only
 * checked its prefix — which let a renter pass the path of their own identity
 * document, so Rekognition compared the document with itself and returned a
 * guaranteed match. The whole check was defeatable in one argument.
 */
export async function submitBookingVerificationSelfie(
  bookingId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const selfie = formData.get("selfie");
  if (!(selfie instanceof File) || selfie.size === 0) {
    return { error: "Brak zdjęcia. Spróbuj ponownie." };
  }
  if (selfie.size > MAX_SELFIE_BYTES) {
    return { error: "Zdjęcie jest za duże." };
  }
  if (!selfie.type.startsWith("image/")) {
    return { error: "To nie jest zdjęcie." };
  }
  const consented = formData.get("biometricConsent") === "on";
  if (!consented) {
    return {
      error:
        "Zaznacz zgodę na porównanie wizerunku — bez niej nie możemy przeprowadzić tego sprawdzenia.",
    };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, owner_id, renter_id, start_date, status, cars(brand, model, year)")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.renter_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }
  if (booking.status !== "accepted") {
    return { error: "Ta rezerwacja nie jest aktywna." };
  }

  const admin = createAdminClient();
  const { data: verification } = await admin
    .from("booking_verifications")
    .select("status, selfie_path")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (!verification) {
    return { error: "Dla tej rezerwacji nie poprosiliśmy jeszcze o potwierdzenie." };
  }
  // Only a case still waiting on the renter may be (re)submitted. Without
  // this, the renter could re-submit a case GoMambo had escalated and pull it
  // back out of the queue — deciding their own escalation.
  if (verification.status !== "pending_renter") {
    return {
      error:
        verification.status === "approved"
          ? "Ta rezerwacja jest już potwierdzona."
          : "To potwierdzenie jest już rozpatrywane — nie musisz nic robić.",
    };
  }

  // Compare against the APPROVED document only. Re-uploading a document
  // resets it to 'pending' (trigger in 0019), and comparing against an
  // unreviewed one would let someone who took over the account swap in their
  // own ID and match against it.
  const { data: identity } = await admin
    .from("identity_verifications")
    .select("id, document_path, biometric_consent_at")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .maybeSingle();

  if (!identity?.document_path) {
    return {
      error:
        "Twoja weryfikacja tożsamości nie jest w tej chwili zatwierdzona — dokończ ją w profilu, zanim potwierdzisz odbiór.",
    };
  }

  const selfiePath = `${user.id}/${crypto.randomUUID()}-booking-selfie.jpg`;
  const selfieBuffer = Buffer.from(await selfie.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from("id-documents")
    .upload(selfiePath, selfieBuffer, { contentType: "image/jpeg" });
  if (uploadError) {
    return { error: `Nie udało się zapisać zdjęcia: ${uploadError.message}` };
  }

  let matchResult: FaceMatchResult = "error";
  let matchScore: number | null = null;
  const { data: docBlob } = await admin.storage
    .from("id-documents")
    .download(identity.document_path);
  if (docBlob) {
    const docBuffer = Buffer.from(await docBlob.arrayBuffer());
    const outcome = await compareFaces(selfieBuffer, docBuffer);
    matchResult = outcome.result;
    matchScore = outcome.score;
  }

  const carLabel = carLabelOf(
    booking.cars as unknown as { brand: string; model: string; year: number } | null
  );

  // Every submission goes to the host. Rafał's decision: a human decides,
  // the automatic comparison is only a hint shown next to the photo. GoMambo
  // can approve any of these too — the admin queue is not a separate path,
  // it is the same one seen from above.
  const nextStatus = "pending_owner";

  const { data: updated, error } = await admin
    .from("booking_verifications")
    .update({
      status: nextStatus,
      selfie_path: selfiePath,
      face_match_result: matchResult,
      face_match_score: matchScore,
      submitted_at: new Date().toISOString(),
    })
    .eq("booking_id", bookingId)
    .eq("status", "pending_renter")
    .select("booking_id")
    .maybeSingle();

  if (error) {
    await admin.storage.from("id-documents").remove([selfiePath]);
    return { error: error.message };
  }
  if (!updated) {
    // Lost a race — don't leave the orphaned image behind.
    await admin.storage.from("id-documents").remove([selfiePath]);
    return { error: "To potwierdzenie jest już rozpatrywane. Odśwież stronę." };
  }

  // A resubmission replaces the previous image rather than accumulating face
  // photos in the private bucket.
  if (verification.selfie_path && verification.selfie_path !== selfiePath) {
    await admin.storage.from("id-documents").remove([verification.selfie_path]);
  }

  // Consent for the biometric comparison, recorded the first time it is given.
  if (!identity.biometric_consent_at) {
    await admin
      .from("identity_verifications")
      .update({ biometric_consent_at: new Date().toISOString() })
      .eq("id", identity.id);
  }

  {
    await notifyUser({
      userId: booking.owner_id,
      type: "booking_verification_pending_owner",
      subject: `Potwierdź najemcę przed wydaniem: ${carLabel}`,
      body: `Najemca ${carLabel} przesłał świeże selfie i przeszedł automatyczne sprawdzenie. Potwierdź, żeby wysłać mu dane do odbioru.`,
      emailHtml: `
        <p>Najemca Twojego auta potwierdził tożsamość przed odbiorem.</p>
        <ul>
          <li><strong>Auto:</strong> ${escapeHtml(carLabel)}</li>
          <li><strong>Odbiór:</strong> ${booking.start_date}</li>
          <li><strong>Podpowiedź automatu:</strong> ${
            matchResult === "match"
              ? `zgodne z dokumentem${matchScore !== null ? ` (${matchScore.toFixed(0)}%)` : ""}`
              : matchResult === "no_match"
                ? `niska zgodność${matchScore !== null ? ` (${matchScore.toFixed(0)}%)` : ""} — obejrzyj zdjęcie uważnie`
                : "brak wyniku — oceń sam"
          }</li>
        </ul>
        <p>Potwierdź w panelu, żeby najemca dostał numer rejestracyjny i kontakt do Ciebie.</p>
        <p><a href="${SITE_URL}/dashboard/bookings">Potwierdź najemcę →</a></p>
      `,
      link: "/dashboard/bookings",
    });
  }

  revalidatePath("/dashboard/rentals");
  revalidatePath("/dashboard/bookings");
  return { error: null };
}

/**
 * The owner's decision. Approving releases the pickup instructions; rejecting
 * does NOT cancel the booking — it is an accusation about someone's identity,
 * so GoMambo looks at it. The owner already has "Odwołaj rezerwację" with a
 * full refund if they simply don't want to hand the car over.
 */
export async function decideBookingVerification(
  bookingId: string,
  decision: "approve" | "reject",
  reason: string
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, owner_id, renter_id, start_date, status, cars(brand, model, year)")
    .eq("id", bookingId)
    .single();

  if (!booking || booking.owner_id !== user.id) {
    return { error: "Nie masz dostępu do tej rezerwacji." };
  }

  const carLabel = carLabelOf(
    booking.cars as unknown as { brand: string; model: string; year: number } | null
  );
  const admin = createAdminClient();

  if (decision === "approve") {
    const { data: approved } = await admin
      .from("booking_verifications")
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: user.id,
      })
      .eq("booking_id", bookingId)
      .eq("status", "pending_owner")
      .select("booking_id")
      .maybeSingle();

    if (!approved) {
      return { error: "Nie ma czego potwierdzać — odśwież stronę." };
    }

    await notifyUser({
      userId: booking.renter_id,
      type: "booking_verification_approved",
      subject: `Potwierdzone — odbierasz ${carLabel}`,
      body: `Właściciel potwierdził Twoją tożsamość. Dane do odbioru dostaniesz przed terminem.`,
      emailHtml: `
        <p>Właściciel potwierdził Twoją tożsamość — wszystko gotowe.</p>
        <p>Numer rejestracyjny, miejsce odbioru i kontakt do właściciela wysyłamy przed terminem.</p>
        <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
      `,
      link: "/dashboard/rentals",
    });

    // The daily cron only looks at trips starting today or tomorrow, so an
    // approval that lands after it has already run would otherwise never
    // release the instructions at all.
    await sendPickupInstructionsIfDue(admin, bookingId);

    revalidatePath("/dashboard/bookings");
    revalidatePath("/dashboard/rentals");
    return { error: null };
  }

  const trimmed = reason.trim();
  if (!trimmed) {
    return { error: "Napisz, co budzi Twoje wątpliwości — bez tego nie możemy tego rozstrzygnąć." };
  }

  const { data: escalated } = await admin
    .from("booking_verifications")
    .update({
      status: "escalated",
      escalated_at: new Date().toISOString(),
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    })
    .eq("booking_id", bookingId)
    .eq("status", "pending_owner")
    .select("booking_id")
    .maybeSingle();

  if (!escalated) {
    return { error: "Nie ma czego rozstrzygać — odśwież stronę." };
  }

  await raiseToGoMambo(admin, bookingId, carLabel, `Właściciel nie potwierdził najemcy: ${trimmed}`);

  // The renter is told something is being checked, but never what the owner
  // said about them — that is an unverified accusation.
  await notifyUser({
    userId: booking.renter_id,
    type: "booking_verification_requested",
    subject: `Sprawdzamy jeszcze Twoją rezerwację: ${carLabel}`,
    body: `Zanim wydamy auto, dopytujemy o jeden szczegół. Odezwiemy się do Ciebie — nie musisz nic robić.`,
    emailHtml: `
      <p>Zanim wydamy Ci auto, weryfikujemy jeszcze jeden szczegół tej rezerwacji.</p>
      <p>Odezwiemy się do Ciebie bezpośrednio. Twoja płatność jest bezpieczna — jeśli wynajem nie dojdzie do skutku z naszej strony, zwrócimy całość.</p>
      <p><a href="${SITE_URL}/dashboard/rentals">Zobacz rezerwację →</a></p>
    `,
    link: "/dashboard/rentals",
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/rentals");
  return { error: null };
}
