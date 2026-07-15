import "server-only";
import { RekognitionClient, CompareFacesCommand, DetectFacesCommand, DetectTextCommand } from "@aws-sdk/client-rekognition";
import type { FaceMatchResult } from "@/types/database";

// Auto-approve threshold, deliberately conservative: we own the risk of
// having no liveness/document-authenticity check (see plan), so this only
// fires on a near-certain match. A low score is treated as inconclusive,
// never as evidence of fraud — rejection stays a human-only decision.
export const FACE_MATCH_AUTO_APPROVE_THRESHOLD = 97;

const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const REGION = process.env.AWS_REGION || "eu-west-1";

const client =
  ACCESS_KEY_ID && SECRET_ACCESS_KEY
    ? new RekognitionClient({
        region: REGION,
        credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
      })
    : null;

export type FaceMatchOutcome = { result: FaceMatchResult; score: number | null };

// Unlike verifyRecaptcha's "missing credentials = pass", missing credentials
// here must mean "inconclusive" — falling through to the existing manual
// admin review queue is the entire safety net for this feature, so we can
// never treat "not configured" as "approved".
export async function compareFaces(selfieBytes: Buffer, documentFrontBytes: Buffer): Promise<FaceMatchOutcome> {
  if (!client) {
    console.error("compareFaces: AWS Rekognition credentials not configured, skipping automated match.");
    return { result: "error", score: null };
  }

  try {
    const response = await client.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: selfieBytes },
        TargetImage: { Bytes: documentFrontBytes },
        SimilarityThreshold: 0,
      })
    );

    const matches = response.FaceMatches ?? [];
    // Anything other than exactly one confident match is ambiguous (no
    // face matched, or multiple candidate faces in the document photo) —
    // treat as inconclusive rather than guessing.
    if (matches.length !== 1 || typeof matches[0].Similarity !== "number") {
      return { result: matches.length === 0 ? "no_match" : "error", score: null };
    }

    const score = matches[0].Similarity;
    return { result: score >= FACE_MATCH_AUTO_APPROVE_THRESHOLD ? "match" : "no_match", score };
  } catch (error) {
    console.error("compareFaces: Rekognition call failed", error);
    return { result: "error", score: null };
  }
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
export async function detectSingleFace(imageBytes: Buffer): Promise<FaceDetectionOutcome> {
  if (!client) return { ok: true };

  try {
    const response = await client.send(new DetectFacesCommand({ Image: { Bytes: imageBytes } }));
    const count = response.FaceDetails?.length ?? 0;
    if (count === 0) return { ok: false, reason: "no_face" };
    if (count > 1) return { ok: false, reason: "multiple_faces" };
    return { ok: true };
  } catch (error) {
    console.error("detectSingleFace: Rekognition call failed", error);
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
