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

// Every OTHER face found in the document photo must also clear this.
//
// A Polish licence shows the holder TWICE: the main photo and a small, pale
// second portrait (the ghost image). That second portrait scores much lower
// than the main one, and how much lower varies a lot between documents.
// Measured on real licences: 97.3, 96.5 and 65.1. This threshold was 90,
// tuned on the first of those — and it told the admin "w kadrze jest więcej
// niż jedna osoba" about a genuine licence whose ghost scored 65.
//
// What the check is FOR is a different person in the frame: someone else's
// licence photographed next to your own face, or a photo swapped onto a real
// licence (then the ghost no longer matches). A different person scores far
// below a degraded copy of the same one, so 50 keeps that protection while
// accepting a pale ghost.
export const FACE_MATCH_MIN_PER_FACE_THRESHOLD = 50;

// An extra face that Rekognition could not compare at all is tolerated only if
// it is ghost-sized: at most this fraction of the largest face's area. On the
// licences measured the ghost was 12–41% of the main photo. A face that large
// but uncomparable is not a faint ghost, and goes to a human.
export const UNCOMPARED_FACE_MAX_RELATIVE_AREA = 0.5;

// Minimum sharpness (Rekognition's own 0-100 quality measure) for a selfie to
// be approved automatically.
//
// This exists because of a demonstrated attack, not a theoretical one: crop
// the portrait out of a photo of SOMEONE ELSE'S licence, submit the crop as
// your selfie, and the comparison returns 100.00 against the document it came
// from — every other gate passes and the account is verified as that person.
// Nothing in a face comparison can tell that the "selfie" is a photograph of
// a photograph; that is what liveness detection is for, and we do not have it
// yet.
//
// A portrait cropped out of a licence-sized image is soft: measured at 7.6 on
// a real one, against 83.1 for a genuine phone selfie. A floor of 30 sits in
// that gap with room on both sides. It is a speed bump, not a solution — a
// high-resolution photo of a licence would crop to a sharp portrait — so it
// gates AUTOMATIC APPROVAL ONLY. A genuinely blurry selfie is not rejected;
// it goes to a human, which is where an uncertain case belongs anyway.
export const SELFIE_MIN_SHARPNESS = 30;

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
  /** Every face in the document image: its similarity to the selfie (null if
   *  it could not be compared) and its share of the image area. */
  faces: { similarity: number | null; area: number }[];
};

// Unlike verifyRecaptcha's "missing credentials = pass", missing credentials
// here must mean "inconclusive" — falling through to the existing manual
// admin review queue is the entire safety net for this feature, so we can
// never treat "not configured" as "approved".
export async function compareFaces(selfieBytes: Buffer, documentFrontBytes: Buffer): Promise<FaceMatchOutcome> {
  if (!client) {
    console.error("compareFaces: AWS Rekognition credentials not configured, skipping automated match.");
    return { result: "error", score: null, minScore: null, unmatchedFaces: 0, faces: [] };
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
      const areaOf = (box: { Width?: number; Height?: number } | undefined) =>
        (box?.Width ?? 0) * (box?.Height ?? 0);
      const faces = [
        ...matches.map((match) => ({
          similarity: typeof match.Similarity === "number" ? match.Similarity : 0,
          area: areaOf(match.Face?.BoundingBox),
        })),
        ...(response.UnmatchedFaces ?? []).map((face) => ({
          similarity: null,
          area: areaOf(face.BoundingBox),
        })),
      ];
      if (matches.length === 0) {
        return { result: "no_match", score: null, minScore: null, unmatchedFaces, faces };
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
      if (score === 0) return { result: "error", score: null, minScore: null, unmatchedFaces, faces };
      return {
        result: score >= FACE_MATCH_SAME_PERSON_THRESHOLD ? "match" : "no_match",
        score,
        minScore,
        unmatchedFaces,
        faces,
      };
    } catch (error) {
      console.error(`compareFaces: Rekognition call failed (attempt ${attempt})`, error);
      if (attempt === 2) return { result: "error", score: null, minScore: null, unmatchedFaces: 0, faces: [] };
    }
  }

  return { result: "error", score: null, minScore: null, unmatchedFaces: 0, faces: [] };
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
/**
 * Rekognition's own quality reading for the largest face in a photo. DEFAULT
 * attributes already include Quality, so this costs one call and no extra
 * configuration. Returns null when it cannot be established — callers must
 * treat that as "unknown", never as "fine".
 */
export async function readFaceSharpness(imageBytes: Buffer): Promise<number | null> {
  if (!client) return null;
  try {
    const response = await client.send(new DetectFacesCommand({ Image: { Bytes: imageBytes } }));
    const faces = response.FaceDetails ?? [];
    if (faces.length === 0) return null;
    const sharpness = faces
      .map((f) => f.Quality?.Sharpness)
      .filter((v): v is number => typeof v === "number");
    return sharpness.length > 0 ? Math.max(...sharpness) : null;
  } catch (error) {
    console.error("readFaceSharpness: Rekognition call failed", error);
    return null;
  }
}

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
  /** The document says PRAWO JAZDY. */
  isDrivingLicence: boolean;
  /** The expiry read from field 4b, as DD.MM.YYYY. Null = not established. */
  expiry: string | null;
  /** True/false once an expiry was read; null when it could not be. */
  expired: boolean | null;
  /**
   * A HINT FOR A HUMAN, never grounds for approval: field 4b reads as empty on
   * a licence issued before 19.01.2013. Polish licences of that era were often
   * issued without an expiry and are valid until the EU replacement deadline,
   * 19.01.2033 (Directive 2006/126/EC). But OCR cannot tell an empty field
   * from a date covered by a thumb or lost to glare — an adversarial review
   * showed a covered, EXPIRED date passing as "valid to 2033" — so this only
   * tells the reviewer what they are probably looking at.
   */
  possiblyIndefinite: boolean;
  /** Every date read anywhere on the document, for a human to sanity-check. */
  dates: string[];
};

/** Licences issued before this date could be issued without an expiry. */
const INDEFINITE_ISSUED_BEFORE = new Date(2013, 0, 19);
/** …and must be replaced by this one (EU Directive 2006/126/EC, art. 3(3)). */
export const INDEFINITE_REPLACE_BY = "19.01.2033";

// DD.MM.YYYY, and DD.MM.YY — the older Polish licence prints two-digit years.
// A two-digit year must not be followed by more digits: "16.06.20 40" is a
// four-digit year OCR split with a space, not 16.06.2020.
const DATE_RE = /\b(\d{2})[.\-/\s](\d{2})[.\-/\s](\d{4}|\d{2}(?!\s?\d))\b/;

/**
 * @param century How to read a two-digit year. An expiry (4b) is always in
 *   this century; an issue date (4a) or a birth date can be in the last one,
 *   so those pivot on the current year.
 */
function parseDate(
  raw: string,
  century: "expiry" | "past" = "past"
): { raw: string; date: Date } | null {
  const m = raw.match(DATE_RE);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  let year = Number(y);
  if (y.length === 2) {
    const thisYY = new Date().getFullYear() % 100;
    year = century === "expiry" || year <= thisYY ? 2000 + year : 1900 + year;
  }
  if (!day || !month || month > 12 || day > 31 || year < 1900 || year > 2100) return null;
  const date = new Date(year, month - 1, day);
  // Reject a rolled-over date (31.02.2030 becomes 3 March) — OCR noise, not a date.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { raw: `${d}.${mo}.${year}`, date };
}

type OcrLine = { text: string; left: number; top: number; height: number };

/** The OCR line carrying a given field label ("4a", "4b"), and what follows it. */
function findField(lines: OcrLine[], label: "4a" | "4b") {
  const re = new RegExp(`(^|[^0-9a-z])${label[0]}\\s*${label[1]}\\b\\.?\\s*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(re);
    // "4b:" / "4b," — punctuation after the label is not a value; and a run
    // of dashes is how some documents print "no value".
    if (m) {
      const value = m[2].replace(/^[\s.,:;]+/, "").replace(/^[\s\-–—_]+$/, "").trim();
      return { index: i, line: lines[i], value };
    }
  }
  return null;
}

/**
 * Reads a Polish driving licence: is it one, and when does it expire.
 *
 * Built against real documents of both layouts, after it wrongly held back
 * genuine licences:
 *
 *  - "PRAWO JAZDY" is matched as two WORDS anywhere on the document. On the
 *    older layout OCR reads them as separate lines with other text between,
 *    and requiring them side by side said "dokument nie wygląda na prawo
 *    jazdy" about a licence that plainly is one.
 *  - Dates may have a two-digit year (DD.MM.YY) on the older layout.
 *  - Field 4b may read as EMPTY on a licence issued before 19.01.2013, which
 *    may well be an indefinite one. That is reported as a hint for the
 *    reviewer and is NEVER accepted automatically: OCR cannot tell an empty
 *    field from a date hidden under a thumb or glare, and an adversarial
 *    review showed exactly that turning an expired licence into "valid to
 *    2033". Such a licence goes to a human.
 *
 * The expiry is still anchored to field 4b and never to "some date somewhere
 * in the photo" — a wall calendar behind an expired licence must not count.
 *
 * Fails CLOSED: no Rekognition, nothing readable, or an ambiguous 4b produce a
 * result that cannot satisfy automatic approval.
 */
const EMPTY_LICENCE: LicenceReadOutcome = {
  isDrivingLicence: false,
  expiry: null,
  expired: null,
  possiblyIndefinite: false,
  dates: [],
};

export async function readLicence(imageBytes: Buffer): Promise<LicenceReadOutcome> {
  if (!client) return EMPTY_LICENCE;
  try {
    const response = await client.send(new DetectTextCommand({ Image: { Bytes: imageBytes } }));
    return interpretLicenceText(response.TextDetections ?? []);
  } catch (error) {
    console.error("readLicence: Rekognition call failed", error);
    return EMPTY_LICENCE;
  }
}

/**
 * The reading itself, separated from the Rekognition call so it can be tested
 * against layouts and edge cases that no photo at hand happens to show.
 */
export function interpretLicenceText(
  detections: {
    Type?: string;
    DetectedText?: string;
    Geometry?: { BoundingBox?: { Left?: number; Top?: number; Height?: number } };
  }[],
  today: Date = new Date()
): LicenceReadOutcome {
  const empty = EMPTY_LICENCE;
  const lines: OcrLine[] = detections
    .filter((d) => d.Type === "LINE" && (d.DetectedText ?? "").trim())
    .map((d) => ({
      text: (d.DetectedText ?? "").trim(),
      left: d.Geometry?.BoundingBox?.Left ?? 0,
      top: d.Geometry?.BoundingBox?.Top ?? 0,
      height: d.Geometry?.BoundingBox?.Height ?? 0,
    }));

  // OCR substitutes look-alike characters; normalise the usual ones.
  const words = new Set(
    detections
      .filter((d) => d.Type === "WORD")
      .map((d) => (d.DetectedText ?? "").toUpperCase().replace(/0/g, "O").replace(/[^A-Z]/g, ""))
  );
  const isDrivingLicence =
    (words.has("PRAWO") && words.has("JAZDY")) ||
    /PRAWO\s*JAZDY/i.test(lines.map((l) => l.text).join(" "));

  const dates = lines
    .map((line) => parseDate(line.text))
    .filter((v): v is { raw: string; date: Date } => v !== null)
    .map((v) => v.raw);

  today = new Date(today);
  today.setHours(0, 0, 0, 0);
  const result = (expiry: { raw: string; date: Date }): LicenceReadOutcome => ({
    isDrivingLicence,
    expiry: expiry.raw,
    expired: expiry.date.getTime() < today.getTime(),
    possiblyIndefinite: false,
    dates,
  });

  const field4b = findField(lines, "4b");
  if (!field4b) return { ...empty, isDrivingLicence, dates };

  // A date on the 4b line itself…
  const onLine = parseDate(field4b.value, "expiry");
  if (onLine) return result(onLine);

  // …or, when OCR split it off, on the next line — provided that line sits on
  // the label's row (compared by vertical CENTRE, so a slightly tilted photo
  // or a value printed larger than its label still counts) and is not to the
  // label's left, where the neighbouring column's fields are.
  const next = lines[field4b.index + 1];
  if (!field4b.value && next) {
    const nextDate = parseDate(next.text, "expiry");
    const centre = (l: OcrLine) => l.top + l.height / 2;
    const rowTolerance = Math.max(2 * field4b.line.height, 0.035);
    const onLabelRow = Math.abs(centre(next) - centre(field4b.line)) < rowTolerance;
    const notToTheLeft = next.left >= field4b.line.left - 0.01;
    if (nextDate && onLabelRow && notToTheLeft) return result(nextDate);
  }

  // No expiry read. Never approve on that — but if 4b looks empty on a
  // pre-2013 licence, tell the reviewer it is probably an indefinite one.
  const field4a = findField(lines, "4a");
  const issued = field4a ? parseDate(field4a.value, "past") : null;
  const possiblyIndefinite =
    !field4b.value && !!issued && issued.date.getTime() < INDEFINITE_ISSUED_BEFORE.getTime();

  return { ...empty, isDrivingLicence, possiblyIndefinite, dates };
}
