import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IdentityVerificationHandoff } from "@/types/database";

const TERMINAL_STATUSES = ["completed", "expired", "cancelled"];

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
