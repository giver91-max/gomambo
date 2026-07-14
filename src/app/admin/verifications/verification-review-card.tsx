"use client";

import { useState, useTransition } from "react";
import { approveVerification, rejectVerification } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FaceMatchResult, IdentityVerificationStatus, VerificationMethod } from "@/types/database";

type Props = {
  verification: {
    id: string;
    status: IdentityVerificationStatus;
    rejection_reason: string | null;
    verification_method: VerificationMethod;
    face_match_result: FaceMatchResult;
    face_match_score: number | null;
  };
  userName: string;
  documentUrl: string | null;
  documentBackUrl: string | null;
  selfieUrl: string | null;
};

const faceMatchContext: Record<FaceMatchResult, (score: number | null) => string | null> = {
  not_run: () => null,
  match: (score) => `Automatyczne dopasowanie: ${score}% — zatwierdzone automatycznie.`,
  no_match: (score) =>
    score !== null
      ? `Automatyczne dopasowanie: ${score}% — poniżej progu, wymaga ręcznej weryfikacji.`
      : "Automatyczne dopasowanie: brak jednoznacznego wyniku, wymaga ręcznej weryfikacji.",
  error: () => "Sprawdzanie automatyczne niedostępne — wymaga ręcznej weryfikacji.",
};

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
        {faceMatchContext[verification.face_match_result](verification.face_match_score) && (
          <p className="text-sm text-muted-foreground">
            {faceMatchContext[verification.face_match_result](verification.face_match_score)}
          </p>
        )}
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
