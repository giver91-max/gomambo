"use client";

import { useState, useTransition } from "react";
import { approveVerification, rejectVerification } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  AutoReview,
  FaceMatchResult,
  IdentityVerificationStatus,
  VerificationMethod,
} from "@/types/database";

type Props = {
  verification: {
    id: string;
    status: IdentityVerificationStatus;
    rejection_reason: string | null;
    verification_method: VerificationMethod;
    face_match_result: FaceMatchResult;
    face_match_score: number | null;
    auto_review: AutoReview | null;
  };
  userName: string;
  documentUrl: string | null;
  documentBackUrl: string | null;
  selfieUrl: string | null;
};

/**
 * What the reviewer is told about the machine's opinion.
 *
 * It depends on the STATUS as well as the score, because the two answer
 * different questions and used to be conflated here. face_match_result is
 * 'match' from 97% up, while automatic approval needs 99% AND four further
 * gates (one person in frame, it is a driving licence, field 4b is not
 * expired, the selfie is sharp). So a submission the machine deliberately
 * REFUSED could still be labelled "zatwierdzone automatycznie" on a card
 * showing "Oczekuje" next to an Approve button — telling the only human in
 * the loop that the check had already passed.
 */
function faceMatchContext(
  result: FaceMatchResult,
  score: number | null,
  status: IdentityVerificationStatus,
  reasonsOnCard: boolean
): string | null {
  const pct = score !== null ? `${score.toFixed(1)}%` : "brak wyniku";

  if (status === "approved") {
    return result === "match"
      ? `Automatyczne dopasowanie: ${pct} — przeszło wszystkie automatyczne bramki.`
      : `Zatwierdzone ręcznie. Automat: ${pct}.`;
  }

  switch (result) {
    case "not_run":
      return null;
    case "match":
      // Matched as a person, but something stopped the automatic approval.
      return reasonsOnCard
        ? `Automatyczne dopasowanie: ${pct} — automat NIE zatwierdził tego zgłoszenia.`
        : // Submitted before the reasons were stored with the verification.
          `Automatyczne dopasowanie: ${pct} — automat NIE zatwierdził tego zgłoszenia. Powód jest w powiadomieniu z dnia zgłoszenia.`;
    case "no_match":
      return score !== null
        ? `Automatyczne dopasowanie: ${pct} — poniżej progu, wymaga ręcznej weryfikacji.`
        : "Automatyczne dopasowanie: brak jednoznacznego wyniku, wymaga ręcznej weryfikacji.";
    case "error":
      return "Sprawdzanie automatyczne niedostępne — wymaga ręcznej weryfikacji.";
  }
}

export function VerificationReviewCard({
  verification,
  userName,
  documentUrl,
  documentBackUrl,
  selfieUrl,
}: Props) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveVerification(verification.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Błąd");
      }
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      try {
        await rejectVerification(verification.id, reason);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Błąd");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{userName}</CardTitle>
          {verification.verification_method === "phone_handoff" && (
            <Badge variant="outline">Weryfikacja przez telefon</Badge>
          )}
        </div>
        <Badge
          variant={
            verification.status === "approved"
              ? "default"
              : verification.status === "rejected"
                ? "destructive"
                : "secondary"
          }
        >
          {verification.status === "pending"
            ? "Oczekuje"
            : verification.status === "approved"
              ? "Zweryfikowano"
              : "Odrzucono"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {faceMatchContext(
          verification.face_match_result,
          verification.face_match_score,
          verification.status,
          !!verification.auto_review
        ) && (
          <p className="text-sm text-muted-foreground">
            {faceMatchContext(
              verification.face_match_result,
              verification.face_match_score,
              verification.status,
              !!verification.auto_review
            )}
          </p>
        )}
        <AutoReviewDetails
          review={verification.auto_review}
          status={verification.status}
        />
        <div className="flex flex-wrap gap-3">
          {documentUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
            <img
              src={documentUrl}
              alt="Dokument tożsamości — przód"
              className="max-h-64 rounded-lg border object-contain"
            />
          )}
          {documentBackUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
            <img
              src={documentBackUrl}
              alt="Dokument tożsamości — tył"
              className="max-h-64 rounded-lg border object-contain"
            />
          )}
          {selfieUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
            <img
              src={selfieUrl}
              alt="Selfie"
              className="max-h-64 rounded-lg border object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Brak selfie — użytkownik nie mógł go zrobić (np. brak dostępu do kamery).
            </p>
          )}
        </div>

        {verification.status === "rejected" && verification.rejection_reason && (
          <p className="text-sm text-destructive">
            Powód odrzucenia: {verification.rejection_reason}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {verification.status === "pending" && (
          <div className="space-y-2">
            <Button onClick={handleApprove} disabled={isPending} size="sm">
              Zatwierdź
            </Button>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Powód odrzucenia (opcjonalnie)…"
            />
            <Button onClick={handleReject} disabled={isPending} variant="outline" size="sm">
              Odrzuć
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Why the automat did or did not let this verification through, shown where
 * the decision is made. It used to live only in the notification and e-mail
 * text, so the admin looking at the photos had to go and find it.
 */
function AutoReviewDetails({
  review,
  status,
}: {
  review: AutoReview | null;
  status: IdentityVerificationStatus;
}) {
  if (!review) return null;

  const expiry = review.licenceExpiry
    ? `${review.licenceExpiry}${review.licenceExpired ? " — PRZETERMINOWANE" : ""}`
    : "nie odczytano z dokumentu";
  const blocked = review.reasons.length > 0 || review.previouslyRejected;

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
      {review.previouslyRejected && (
        <p className="font-medium text-destructive">
          Ponowne zgłoszenie po odrzuceniu — automat nigdy nie zatwierdza takiego sam.
        </p>
      )}
      {review.reasons.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium">
            {status === "pending"
              ? "Dlaczego automat nie zatwierdził:"
              : "Automat nie zatwierdził, bo:"}
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {review.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        !blocked && <p className="font-medium">Automat: wszystkie sprawdzenia zaliczone.</p>
      )}
      <p className={review.licenceExpired ? "font-medium text-destructive" : "text-muted-foreground"}>
        Prawo jazdy ważne do (pole 4b): {expiry}
      </p>
    </div>
  );
}
