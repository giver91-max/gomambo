"use client";

import { useState, useTransition } from "react";
import { approveVerification, rejectVerification } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { IdentityVerificationStatus } from "@/types/database";

type Props = {
  verification: {
    id: string;
    status: IdentityVerificationStatus;
    rejection_reason: string | null;
  };
  userName: string;
  documentUrl: string | null;
};

export function VerificationReviewCard({ verification, userName, documentUrl }: Props) {
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
        <CardTitle className="text-base">{userName}</CardTitle>
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
        {documentUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
          <img
            src={documentUrl}
            alt="Dokument tożsamości"
            className="max-h-64 rounded-lg border object-contain"
          />
        )}

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
