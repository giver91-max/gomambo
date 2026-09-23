"use client";

import { useState, useTransition } from "react";
import { decidePartner, verifyPartnerDocument } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DecidePartner({
  partnerId,
  status,
}: {
  partnerId: string;
  status: string;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(next: "active" | "suspended" | "terminated" | "pending") {
    setError(null);
    startTransition(async () => {
      const result = await decidePartner(partnerId, next, reason);
      if (result?.error) setError(result.error);
      else setReason("");
    });
  }

  return (
    <div className="space-y-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Powód (wymagany przy odmowie, zawieszeniu i zakończeniu)"
      />
      <div className="flex flex-wrap gap-2">
        {status !== "active" && (
          <Button type="button" size="sm" disabled={isPending} onClick={() => decide("active")}>
            {isPending ? "Chwileczkę…" : "Zweryfikuj — może dodawać auta"}
          </Button>
        )}
        {status === "active" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => decide("suspended")}
          >
            Zawieś
          </Button>
        )}
        {status !== "pending" && status !== "active" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => decide("pending")}
          >
            Wróć do weryfikacji
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive"
          disabled={isPending}
          onClick={() => decide("terminated")}
        >
          Zakończ współpracę
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function VerifyDocumentButton({ documentId }: { documentId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => verifyPartnerDocument(documentId).then(() => undefined))}
    >
      {isPending ? "…" : "Oznacz jako sprawdzony"}
    </Button>
  );
}
