import "server-only";
import { RekognitionClient, CompareFacesCommand, DetectFacesCommand, DetectTextCommand } from "@aws-sdk/client-rekognition";
import type { FaceMatchResult } from "@/types/database";

// TWO thresholds, because one number was being asked to answer two different
// questions and the answers are not the same.
//
// "Is this plausibly the same person?" — the hint shown next to the photos to
// whoever reviews them. Unchanged.
export const FACE_MATCH_SAME_PERSON_THRESHOLD = 97;

// "Is this certain enough to let through with nobody looking?" — a strictly
// higher bar, per Rafał: "podobieństwo musi być wysokie, żeby nie było
// błędów". 99 is AWS's own recommendation for identity verification. The
// first real comparison on this platform scored 99.92, so a genuine match
// clears it comfortably; the cost falls on borderline photos, which go to a
// human instead of through. Keeping these separate matters: at a single
// threshold of 99, a perfectly good 98% match would have been shown to the
// host as "niska zgodność" — an accusation, not a hint.
//
// A low score is never evidence of fraud. Rejection stays a human decision.
export const FACE_MATCH_AUTO_APPROVE_THRESHOLD = 99;

// Every OTHER face found in the document photo must also clear this. A real
// licence shows one person twice (photo + ghost portrait, measured at 99.9
// and 97.3 on a real Polish licence), so a genuine document passes easily;
// a second, different person in the frame does not.
export const FACE_MATCH_MIN_PER_FACE_THRESHOLD = 90;

// AWS_* is a RESERVED prefix in the serverless runtime: Lambda injects its
// own AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN and
// AWS_REGION for the function's execution role, and those win over anything
// configured in the project. The client was therefore built in production
// with Lambda's own role, which has no Rekognition permission — every call
// failed and was recorded as face_match_result 'error'. Locally the same
// credentials work fine, which is why this never showed up in testing.
//
// REKOGNITION_* is what production reads; the AWS_* fallback keeps local
// development and any existing setup working unchanged.
const ACCESS_KEY_ID =
  process.env.REKOGNITION_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY =
  process.env.REKOGNITION_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const REGION =
  process.env.REKOGNITION_REGION || process.env.AWS_REGION || "eu-west-1";

const client =
  ACCESS_KEY_ID && SECRET_ACCESS_KEY
    ? new RekognitionClient({
        region: REGION,
        credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
      })
    : null;

export type FaceMatchOutcome = {
  result: FaceMatchResult;
  /** The BEST similarity found — what a human reviewer is shown as a hint. */
  score: number | null;
  /**
   * The WEAKEST similarity among the faces found in the document image, and
   * how many faces could not be compared at all.
   *
   * These exist because taking the best match alone is exploitable: a Polish
   * licence legitimately carries two portraits of the SAME person (the photo
   * and the ghost image), but nothing stops someone photographing SOMEONE
   * ELSE'S licence while holding their own face in the frame. Rekognition
   * then returns two entries — the stranger low, the attacker ~100 — and
   * max() happily picks the attacker's. Requiring every face in the frame to
   * match closes that, because a genuine document only ever shows one person.
   */
  minScore: number | null;
  unmatchedFaces: number;
};

// Unlike verifyRecaptcha's "missing credentials = pass", missing credentials
// here must mean "inconclusive" — falling through to the existing manual
// admin review queue is the entire safety net for this feature, so we can
// never treat "not configured" as "approved".
export async function compareFaces(selfieBytes: Buffer, documentFrontBytes: Buffer): Promise<FaceMatchOutcome> {
  if (!client) {
    console.error("compareFaces: AWS Rekognition credentials not configured, skipping automated match.");
    return { result: "error", score: null, minScore: null, unmatchedFaces: 0 };
  }

  // One retry on transient failures (network blip, cold-start latency
  // against Rekognition) before giving up — verified against real user
  // photos that a working call reliably returns a confident match, so a
  // bare "error" on the first try is far more likely to be transient than
  // a genuine no-face/multi-face condition (which surfaces as "no_match",
  // not an exception, and doesn't benefit from retrying).
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: selfieBytes },
          TargetImage: { Bytes: documentFrontBytes },
          SimilarityThreshold: 0,
        })
      );

      const matches = response.FaceMatches ?? [];
      const unmatchedFaces = (response.UnmatchedFaces ?? []).length;
      if (matches.length === 0) {
        return { result: "no_match", score: null, minScore: null, unmatchedFaces };
      }

      // Take the BEST match, not "exactly one".
      //
      // A Polish driving licence carries TWO portraits of the same person:
      // the main photo and a smaller semi-transparent ghost image printed as
      // a security feature. Practically every EU document does. Requiring a
      // single match therefore returned "error" for every real licence —
      // the holder matched twice, which the old code read as ambiguity.
      const similarities = matches.map((match) =>
        typeof match.Similarity === "number" ? match.Similarity : 0
      );
      const score = Math.max(...similarities);
      const minScore = Math.min(...similarities);
      if (score === 0) return { result: "error", score: null, minScore: null, unmatchedFaces };
      return {
        result: score >= FACE_MATCH_SAME_PERSON_THRESHOLD ? "match" : "no_match",
        score,
        minScore,
        unmatchedFaces,
      };
    } catch (error) {
      console.error(`compareFaces: Rekognition call failed (attempt ${attempt})`, error);
      if (attempt === 2) return { result: "error", score: null, minScore: null, unmatchedFaces: 0 };
    }
  }

  return { result: "error", score: null, minScore: null, unmatchedFaces: 0 };
}

export type FaceDetectionOutcome = { ok: boolean; reason?: "no_face" | "multiple_faces" };

// A cheap pre-check run right after each photo upload, so a bad shot (no
// face visible, or two people in frame) gets caught and the user is asked
// to retake it immediately — instead of only finding out it was unusable
// once compareFaces() runs at the very end of the whole flow. This is a
// UX nicety, not a security boundary: on a missing-credentials or
// transient-error case it lets the upload through rather than blocking the
// user for something that isn't their fault — compareFaces() at finalize
// time is still the authoritative check and routes to manual review if
// anything is actually wrong.
export async function detectFace(
  imageBytes: Buffer,
  // What the photo is supposed to show. It decides whether more than one
  // face is a problem: on a SELFIE it means a second person wandered into
  // frame, on a DOCUMENT it is the normal state of affairs, because a Polish
  // driving licence prints a ghost portrait next to the main photo. Treating
  // the document like a selfie rejected every genuine licence.
  subject: "document" | "selfie"
): Promise<FaceDetectionOutcome> {
  if (!client) return { ok: true };

  try {
    const response = await client.send(new DetectFacesCommand({ Image: { Bytes: imageBytes } }));
    const count = response.FaceDetails?.length ?? 0;
    if (count === 0) return { ok: false, reason: "no_face" };
    if (subject === "selfie" && count > 1) return { ok: false, reason: "multiple_faces" };
    return { ok: true };
  } catch (error) {
    console.error("detectFace: Rekognition call failed", error);
    return { ok: true };
  }
}

export type LegibilityOutcome = { ok: boolean };

// A real license photo — even a mediocre one — has plenty of printed text
// (name, dates, document number, category table). A blurry, dark, or badly
// cropped shot detects very few lines, if any, so a low count is a cheap
// proxy for "unreadable" without having to actually interpret what the
// text says. Deliberately conservative (low bar) since there's no real
// license imagery to calibrate against — same missing-credentials/error
// graceful degrade as the other checks, this never blocks on our own account.
const MIN_TEXT_LINES = 3;

export async function checkDocumentLegibility(imageBytes: Buffer): Promise<LegibilityOutcome> {
  if (!client) return { ok: true };

  try {
    const response = await client.send(new DetectTextCommand({ Image: { Bytes: imageBytes } }));
    const lineCount = (response.TextDetections ?? []).filter((d) => d.Type === "LINE").length;
    return { ok: lineCount >= MIN_TEXT_LINES };
  } catch (error) {
    console.error("checkDocumentLegibility: Rekognition call failed", error);
    return { ok: true };
  }
}

export type LicenceReadOutcome = {
  /** The document actually says PRAWO JAZDY. */
  isDrivingLicence: boolean;
  /** The date printed in field 4b, whatever it is. Null = could not read it. */
  expiry: string | null;
  /** True/false once 4b was read; null when it could not be read at all. */
  expired: boolean | null;
  /** Every date read anywhere on the document, for a human to sanity-check. */
  dates: string[];
};

const DATE_RE = /\b(\d{2})[.\-/\s](\d{2})[.\-/\s](\d{4})\b/;

function parseDate(raw: string): { raw: string; date: Date } | null {
  const m = raw.match(DATE_RE);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);
  if (!day || !month || month > 12 || day > 31 || year < 1900 || year > 2100) return null;
  const date = new Date(year, month - 1, day);
  // Reject a rolled-over date (31.02.2030 becomes 3 March) — OCR noise, not a date.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { raw: `${d}.${mo}.${y}`, date };
}

/**
 * Reads a Polish driving licence: is it one, and what does field 4b say.
 *
 * The earlier version took ANY future-looking date found anywhere in the
 * frame, which was not a validity check at all — an expired licence held in
 * front of a wall calendar showing 2030 would have satisfied it, and the
 * calendar's date would have been "the expiry". So the date is now ANCHORED
 * to the 4b label, which is where a Polish licence prints its expiry, and a
 * date that isn't on the 4b line is never treated as one.
 *
 * Fails CLOSED in every direction: no Rekognition, no 4b line, an unreadable
 * date, or a document that doesn't say PRAWO JAZDY all produce a result that
 * cannot satisfy automatic approval, and the verification goes to a human.
 */
export async function readLicence(imageBytes: Buffer): Promise<LicenceReadOutcome> {
  const empty: LicenceReadOutcome = {
    isDrivingLicence: false,
    expiry: null,
    expired: null,
    dates: [],
  };
  if (!client) return empty;

  try {
    const response = await client.send(new DetectTextCommand({ Image: { Bytes: imageBytes } }));
    const lines = (response.TextDetections ?? [])
      .filter((d) => d.Type === "LINE")
      .map((d) => (d.DetectedText ?? "").trim())
      .filter(Boolean);

    const joined = lines.join(" ");
    // OCR routinely splits or spaces this; accept both words adjacent.
    const isDrivingLicence = /PRAWO\s*JAZDY/i.test(joined);

    const dates = lines
      .map((line) => parseDate(line))
      .filter((v): v is { raw: string; date: Date } => v !== null)
      .map((v) => v.raw);

    // Field 4b. On a real licence the label and the date sit on one OCR line
    // ("4b.16.06.2040"); occasionally the label lands on its own line and the
    // date follows, so check the next line too.
    let expiryParsed: { raw: string; date: Date } | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (!/(^|[^0-9a-z])4\s*b\b/i.test(lines[i])) continue;
      expiryParsed = parseDate(lines[i]) ?? (i + 1 < lines.length ? parseDate(lines[i + 1]) : null);
      if (expiryParsed) break;
    }

    if (!expiryParsed) return { isDrivingLicence, expiry: null, expired: null, dates };

    // Compare against the start of today, so a licence expiring today still
    // counts as valid rather than flipping at midnight-plus-one-second.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      isDrivingLicence,
      expiry: expiryParsed.raw,
      expired: expiryParsed.date.getTime() < today.getTime(),
      dates,
    };
  } catch (error) {
    console.error("readLicence: Rekognition call failed", error);
    return empty;
  }
}
