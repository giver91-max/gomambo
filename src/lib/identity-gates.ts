import "server-only";
import type { AutoReview } from "@/types/database";
import {
  FACE_MATCH_AUTO_APPROVE_THRESHOLD,
  FACE_MATCH_MIN_PER_FACE_THRESHOLD,
  SELFIE_MIN_SHARPNESS,
  UNCOMPARED_FACE_MAX_RELATIVE_AREA,
  compareFaces,
  readFaceSharpness,
  INDEFINITE_REPLACE_BY,
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
    match: { result: "error", score: null, minScore: null, unmatchedFaces: 0, faces: [] },
    licence: { isDrivingLicence: false, expiry: null, expired: null, possiblyIndefinite: false, dates: [] },
    gates,
    passes: false,
  };
}

/**
 * The document shows the holder TWICE, and only the holder.
 *
 * A Polish licence carries the main photo and a small, pale second portrait.
 * Requiring both to be found and to match does two jobs:
 *
 *  - It binds the ≥99 match to an actual document. Without it, someone could
 *    cover the photo on another person's licence with a thumb and hold their
 *    own face in the frame: one face, theirs, matching perfectly. (Found by an
 *    adversarial review; it predates the ghost-portrait threshold change.)
 *  - It catches a different person in the frame, or a photo swapped onto a
 *    real licence: the other portrait then no longer matches.
 *
 * Each compared face must clear FACE_MATCH_MIN_PER_FACE_THRESHOLD — the second
 * portrait scores well below the main one (65–99 on real licences). A face
 * that could not be compared at all is accepted only if it is ghost-sized.
 */
function onlyTheHolderInFrame(match: IdentityAssessment["match"]): boolean {
  const compared = match.faces.filter((f) => f.similarity !== null);
  if (compared.length < 2) return false;
  const largest = Math.max(...match.faces.map((f) => f.area));
  return match.faces.every((face) =>
    face.similarity === null
      ? largest > 0 && face.area / largest <= UNCOMPARED_FACE_MAX_RELATIVE_AREA
      : face.similarity >= FACE_MATCH_MIN_PER_FACE_THRESHOLD
  );
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
    onlyOnePerson: onlyTheHolderInFrame(match),
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
/**
 * Why the automatic approval did not fire, one plain sentence per failed gate.
 * Shared by the in-app queue entry and the admin e-mail so the two can never
 * disagree about what the reviewer should look at.
 */
export function assessmentReasons(assessment: IdentityAssessment): string[] {
  const { gates } = assessment;
  const reasons: string[] = [];
  if (!gates.strongMatch) {
    reasons.push(`zgodność poniżej progu ${FACE_MATCH_AUTO_APPROVE_THRESHOLD}%`);
  }
  if (!gates.onlyOnePerson) reasons.push(describeFaceProblem(assessment));
  if (!gates.isLicence) {
    reasons.push("nie odczytano napisu PRAWO JAZDY — sprawdź, czy to prawo jazdy i czy zdjęcie jest wyraźne");
  }
  if (!gates.notExpired) {
    reasons.push(
      assessment.licence.expired
        ? "prawo jazdy jest PRZETERMINOWANE (pole 4b)"
        : assessment.licence.possiblyIndefinite
          ? `pole 4b jest puste, a prawo jazdy wydano przed 2013 r. — prawdopodobnie bezterminowe (ważne do ${INDEFINITE_REPLACE_BY}); sprawdź, czy data nie jest zasłonięta lub nieczytelna`
          : "nie odczytano daty ważności (pole 4b) — sprawdź ją na zdjęciu"
    );
  }
  if (!gates.selfieIsSharp) {
    reasons.push("selfie nieostre — sprawdź, czy to żywe zdjęcie, a nie zdjęcie zdjęcia");
  }
  return reasons;
}

/**
 * What gets stored WITH the verification, so the review card can show why the
 * automat did or did not let it through — instead of sending the admin off to
 * find the reason in a notification.
 */
export function buildAutoReview(
  assessment: IdentityAssessment,
  previouslyRejected: boolean
): AutoReview {
  return {
    reasons: assessmentReasons(assessment),
    licenceExpiry: assessment.licence.expiry,
    licenceExpired: assessment.licence.expired,
    licencePossiblyIndefinite: assessment.licence.possiblyIndefinite,
    previouslyRejected,
  };
}

/** The face gate in words, with the numbers the reviewer needs to judge it. */
function describeFaceProblem({ match }: IdentityAssessment): string {
  if (match.result === "error") {
    return "automat nie mógł porównać twarzy (błąd usługi) — oceń zdjęcia samodzielnie";
  }
  const compared = match.faces.filter((f) => f.similarity !== null) as {
    similarity: number;
    area: number;
  }[];
  const weak = compared.filter((f) => f.similarity < FACE_MATCH_MIN_PER_FACE_THRESHOLD);
  if (weak.length > 0) {
    const worst = Math.min(...weak.map((f) => f.similarity));
    return `na dokumencie jest twarz, która pasuje do selfie tylko w ${worst.toFixed(0)}% — sprawdź, czy to ta sama osoba`;
  }
  const uncompared = match.faces.length - compared.length;
  if (compared.length === 0) return "nie znaleziono twarzy na zdjęciu dokumentu";
  if (compared.length === 1 && uncompared > 0) {
    return "drugiego zdjęcia na dokumencie nie dało się porównać (zbyt blade lub zasłonięte) — sprawdź, czy to ta sama osoba";
  }
  if (compared.length === 1) {
    return "na dokumencie widać tylko jedno zdjęcie — polskie prawo jazdy ma dwa; sprawdź, czy dokument nie jest zasłonięty i czy to na pewno ta osoba";
  }
  return "na zdjęciu dokumentu jest dodatkowa twarz, której nie dało się porównać — sprawdź, czy w kadrze nie ma innej osoby";
}

/** "Prawo jazdy ważne do …", or that it could not be read. */
export function describeExpiry(assessment: IdentityAssessment): string {
  const { licence } = assessment;
  if (licence.expiry) return `${licence.expiry}${licence.expired ? " (PRZETERMINOWANE)" : ""}`;
  if (licence.possiblyIndefinite) {
    return `pole 4b puste — prawdopodobnie bezterminowe (wymiana do ${INDEFINITE_REPLACE_BY})`;
  }
  return "nie odczytano";
}

export function describeAssessment(assessment: IdentityAssessment): string {
  const { match } = assessment;
  const hint =
    match.score !== null
      ? ` Automat: zgodność ${match.score.toFixed(1)}%`
      : " Automat: brak wyniku";
  const expiry = assessment.licence.expiry
    ? `, prawo jazdy ważne do ${describeExpiry(assessment)}`
    : ", daty ważności nie odczytano";
  const reasons = assessmentReasons(assessment);
  return `${hint}${expiry}.${reasons.length ? ` Do sprawdzenia: ${reasons.join("; ")}.` : ""}`;
}
