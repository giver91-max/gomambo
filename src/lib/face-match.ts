import "server-only";
import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";
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
