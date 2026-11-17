import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, HandoffStatus, IdentityVerificationHandoff } from "@/types/database";

const TERMINAL_STATUSES = ["completed", "expired", "cancelled"];

/** Statuses of a phone session that can still be continued. */
export const LIVE_HANDOFF_STATUSES: HandoffStatus[] = [
  "pending",
  "code_sent",
  "claimed",
  "photos_uploaded",
];

// How long a phone session lives. The column's default (0026) is 15 minutes
// from the moment the QR code is shown, and that had to cover finding the
// licence, waiting for the e-mail code and every retake — run past it and the
// next photo failed with "nie jest już aktywna", the photos already taken
// were lost, and the desktop kept showing a dead code. So the session gets an
// hour up front and every completed step pushes the deadline to at least
// HANDOFF_ACTIVITY_WINDOW_MS ahead: someone who is actively taking photos is
// never cut off half-way. HANDOFF_MAX_LIFETIME_MS caps how long a link that
// already passed the e-mail code can be kept alive.
export const HANDOFF_TTL_MS = 60 * 60 * 1000;
const HANDOFF_ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
const HANDOFF_MAX_LIFETIME_MS = 3 * 60 * 60 * 1000;

// finalizeHandoff claims a session (status 'completed', no result id yet)
// before saving the verification and links the two afterwards. The claim
// comes after the slow part — the Rekognition checks — so what is left is a
// few database writes, and no function on this Vercel plan runs longer than
// five minutes in all. A claim still unlinked after that was left behind by a
// finalize that failed or died half-way: without a way out the phone would
// answer every retry with "zapisujemy wynik", the desktop would wait for ever
// and the session's photos would never be removed.
export const STALE_HANDOFF_CLAIM_MS = 5 * 60 * 1000;

/** A session claimed by finalizeHandoff that was never linked to a verification, long enough ago to be given up on. */
export function isAbandonedClaim(
  handoff: Pick<IdentityVerificationHandoff, "status" | "result_identity_verification_id" | "updated_at">
): boolean {
  return (
    handoff.status === "completed" &&
    !handoff.result_identity_verification_id &&
    // updated_at is set by a trigger (0026) and nothing else writes an
    // unlinked 'completed' row, so it is the moment of the claim.
    new Date(handoff.updated_at).getTime() < Date.now() - STALE_HANDOFF_CLAIM_MS
  );
}

/** The cut-off for a conditional update that must only touch a still-abandoned claim. */
export function abandonedClaimCutoff(): string {
  return new Date(Date.now() - STALE_HANDOFF_CLAIM_MS).toISOString();
}

export function newHandoffExpiry(): string {
  return new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
}

/** The deadline after a completed step: never earlier than it was. */
export function extendedHandoffExpiry(
  handoff: Pick<IdentityVerificationHandoff, "handoff_expires_at" | "created_at">
): string {
  const current = new Date(handoff.handoff_expires_at).getTime();
  const cap = new Date(handoff.created_at).getTime() + HANDOFF_MAX_LIFETIME_MS;
  const wanted = Math.max(current, Date.now() + HANDOFF_ACTIVITY_WINDOW_MS);
  return new Date(Math.min(wanted, Math.max(cap, current))).toISOString();
}

export function generateHandoffToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function generateEmailCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashEmailCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function codeMatches(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashEmailCode(code));
  const expected = Buffer.from(hash);
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// No infra for background jobs in this repo, so expiry is checked lazily
// on every read instead of via a cron sweep — consistent with the rest of
// the codebase.
export async function getHandoffByToken(token: string): Promise<IdentityVerificationHandoff | null> {
  const admin = createAdminClient();
  const { data: handoff } = await admin
    .from("identity_verification_handoffs")
    .select("*")
    .eq("token", token)
    .single();

  if (!handoff) return null;

  const isExpired = new Date(handoff.handoff_expires_at).getTime() < Date.now();
  if (isExpired && !TERMINAL_STATUSES.includes(handoff.status)) {
    const { data: updated } = await admin
      .from("identity_verification_handoffs")
      .update({ status: "expired" })
      .eq("id", handoff.id)
      .select("*")
      .single();
    return updated ?? { ...handoff, status: "expired" };
  }

  return handoff;
}

/** The photo paths the user's identity verification currently points at. */
export async function currentVerificationPaths(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<string[]> {
  const { data } = await admin
    .from("identity_verifications")
    .select("document_path, document_back_path, selfie_path")
    .eq("user_id", userId)
    .maybeSingle();
  return [data?.document_path, data?.document_back_path, data?.selfie_path].filter(
    (p): p is string => !!p
  );
}

/**
 * Closes every unfinished phone session of a user and deletes the photos
 * they collected.
 *
 * Called when something newer supersedes them — a fresh QR code, a desktop
 * submission — so the desktop's realtime subscription is never ambiguous, a
 * stale session cannot finish later and overwrite the newer result, and the
 * identity documents of an abandoned attempt do not sit in storage for ever
 * (privacy policy §5). Photos the current verification points at are never
 * touched: after "Spróbuj jeszcze raz" an unfinished session still shares its
 * licence photos with the saved verification.
 *
 * A session finalizeHandoff has already claimed (status 'completed') is left
 * alone, even one claimed between the read and the cancel below: the cancel
 * only touches rows still live, and only the sessions it actually closed (or
 * that were closed before) lose their photos — otherwise a finalize in flight
 * would save a verification whose images had just been deleted. The one
 * exception is a claim abandoned long ago (isAbandonedClaim): no finalize is
 * running for it any more, so it is closed like a live session.
 */
export async function retireUnfinishedHandoffs(
  admin: SupabaseClient<Database>,
  userId: string,
  keepPaths: string[]
): Promise<void> {
  const { data: rows } = await admin
    .from("identity_verification_handoffs")
    .select(
      "id, status, updated_at, result_identity_verification_id, document_front_path, document_back_path, selfie_path"
    )
    .eq("user_id", userId)
    .or("status.neq.completed,result_identity_verification_id.is.null");
  const unfinished = (rows ?? []).filter((h) => h.status !== "completed" || isAbandonedClaim(h));
  if (unfinished.length === 0) return;

  const live = unfinished.filter((h) => LIVE_HANDOFF_STATUSES.includes(h.status)).map((h) => h.id);
  const abandoned = unfinished.filter((h) => h.status === "completed").map((h) => h.id);
  const cancelled = new Set<string>();
  const logCancelError = (error: { message: string } | null) => {
    if (error) {
      console.error("[verification-handoff] could not close unfinished sessions", {
        userId,
        message: error.message,
      });
    }
  };
  if (live.length > 0) {
    const { data: closed, error } = await admin
      .from("identity_verification_handoffs")
      .update({ status: "cancelled" })
      .in("id", live)
      .in("status", LIVE_HANDOFF_STATUSES)
      .select("id");
    logCancelError(error);
    for (const row of closed ?? []) cancelled.add(row.id);
  }
  if (abandoned.length > 0) {
    // Re-checked in the update itself: a claim released and taken again by a
    // retry on the phone in the meantime is fresh, and stays.
    const { data: closed, error } = await admin
      .from("identity_verification_handoffs")
      .update({ status: "cancelled" })
      .in("id", abandoned)
      .eq("status", "completed")
      .is("result_identity_verification_id", null)
      .lt("updated_at", abandonedClaimCutoff())
      .select("id");
    logCancelError(error);
    for (const row of closed ?? []) cancelled.add(row.id);
  }
  const retired = unfinished.filter(
    (h) =>
      (!LIVE_HANDOFF_STATUSES.includes(h.status) && h.status !== "completed") || cancelled.has(h.id)
  );

  const keep = new Set([...keepPaths, ...(await currentVerificationPaths(admin, userId))]);
  const withPhotos = retired.filter(
    (h) => h.document_front_path || h.document_back_path || h.selfie_path
  );
  const doomed = withPhotos
    .flatMap((h) => [h.document_front_path, h.document_back_path, h.selfie_path])
    .filter((p): p is string => !!p && !keep.has(p));
  if (doomed.length > 0) {
    const { error } = await admin.storage.from("id-documents").remove(doomed);
    if (error) {
      console.error("[verification-handoff] could not remove superseded photos", {
        userId,
        message: error.message,
      });
      return;
    }
  }
  if (withPhotos.length > 0) {
    await admin
      .from("identity_verification_handoffs")
      .update({ document_front_path: null, document_back_path: null, selfie_path: null })
      .in(
        "id",
        withPhotos.map((h) => h.id)
      );
  }
}
