import "server-only";
import {
  FACE_MATCH_AUTO_APPROVE_THRESHOLD,
  FACE_MATCH_MIN_PER_FACE_THRESHOLD,
  SELFIE_MIN_SHARPNESS,
  compareFaces,
  readFaceSharpness,
  readLicence,
} from "@/lib/face-match";

/**
 * The single place that decides whether an identity verification may be
 * approved with nobody looking at it.
 *
 * It lives here rather than in either route because there are two ways in —
 * the QR handoff on a phone and the upload form on a desktop — and they must
 * not be allowed to drift. A gate tightened in one and forgotten in the other
 * is a hole that looks like a fix.
 *
 * Every gate FAILS CLOSED. Rekognition not configured, a transient error, an
 * unreadable document: all of them produce a result that cannot satisfy
 * automatic approval, so the verification goes to a human.
 */
export type IdentityGates = {
  /** The selfie matches the portrait, with near-certainty. */
  strongMatch: boolean;
  /**
   * EVERY face in the document frame is that same person. A real licence
   * shows one person twice (the photo and the ghost portrait); a second,
   * DIFFERENT face means someone else's document is in the shot — which
   * taking the best match alone would reward rather than catch.
   */
  onlyOnePerson: boolean;
  /** The document says PRAWO JAZDY — not an ID card, not a photo of a screen. */
  isLicence: boolean;
  /** Field 4b was read and is not in the past. */
  notExpired: boolean;
  /**
   * The selfie is sharp enough not to be a portrait cropped out of a photo of
   * the document. See SELFIE_MIN_SHARPNESS — this is a speed bump against a
   * demonstrated attack, not a substitute for liveness detection.
   */
  selfieIsSharp: boolean;
};

export type IdentityAssessment = {
  match: Awaited<ReturnType<typeof compareFaces>>;
  licence: Awaited<ReturnType<typeof readLicence>>;
  gates: IdentityGates;
  /** All gates cleared. Still not sufficient on its own — see the callers,
   *  which additionally refuse to overrule a human's rejection. */
  passes: boolean;
};

export function emptyAssessment(): IdentityAssessment {
  const gates: IdentityGates = {
    strongMatch: false,
    onlyOnePerson: false,
    isLicence: false,
    notExpired: false,
    selfieIsSharp: false,
  };
  return {
    match: { result: "error", score: null, minScore: null, unmatchedFaces: 0 },
    licence: { isDrivingLicence: false, expiry: null, expired: null, dates: [] },
    gates,
    passes: false,
  };
}

export async function assessIdentity(
  selfieBytes: Buffer,
  licenceFrontBytes: Buffer
): Promise<IdentityAssessment> {
  const [match, licence, selfieSharpness] = await Promise.all([
    compareFaces(selfieBytes, licenceFrontBytes),
    readLicence(licenceFrontBytes),
    readFaceSharpness(selfieBytes),
  ]);

  const gates: IdentityGates = {
    strongMatch:
      match.result === "match" &&
      match.score !== null &&
      match.score >= FACE_MATCH_AUTO_APPROVE_THRESHOLD,
    onlyOnePerson:
      match.unmatchedFaces === 0 &&
      match.minScore !== null &&
      match.minScore >= FACE_MATCH_MIN_PER_FACE_THRESHOLD,
    isLicence: licence.isDrivingLicence,
    notExpired: licence.expiry !== null && licence.expired === false,
    selfieIsSharp: selfieSharpness !== null && selfieSharpness >= SELFIE_MIN_SHARPNESS,
  };

  return { match, licence, gates, passes: Object.values(gates).every(Boolean) };
}

/**
 * What the admin queue is told. Says WHICH gate stopped it, so the reviewer
 * knows what to look at instead of re-deriving it from a bare score.
 */
export function describeAssessment(assessment: IdentityAssessment): string {
  const { match, licence, gates } = assessment;

  const hint =
    match.score !== null
      ? ` Automat: zgodność ${match.score.toFixed(1)}%`
      : " Automat: brak wyniku";
  const expiry = licence.expiry
    ? `, prawo jazdy ważne do ${licence.expiry}${licence.expired ? " (PRZETERMINOWANE)" : ""}`
    : ", daty ważności nie odczytano";

  const reasons: string[] = [];
  if (!gates.strongMatch) {
    reasons.push(`zgodność poniżej progu ${FACE_MATCH_AUTO_APPROVE_THRESHOLD}%`);
  }
  if (!gates.onlyOnePerson) reasons.push("w kadrze dokumentu jest więcej niż jedna osoba");
  if (!gates.isLicence) reasons.push("dokument nie wygląda na prawo jazdy");
  if (!gates.notExpired) reasons.push("nie potwierdzono ważności (pole 4b)");
  if (!gates.selfieIsSharp) {
    reasons.push("selfie nieostre — sprawdź, czy to żywe zdjęcie, a nie zdjęcie zdjęcia");
  }

  return `${hint}${expiry}.${reasons.length ? ` Do sprawdzenia: ${reasons.join("; ")}.` : ""}`;
}
