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

  function decide(next: "active" | "suspended" | "terminated" | "pending" | "draft") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await decidePartner(partnerId, next, reason);
        if (result?.error) setError(result.error);
        else setReason("");
      } catch {
        setError("Nie udało się zapisać decyzji — sprawdź połączenie i spróbuj ponownie.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Powód (wymagany przy prośbie o poprawki, zawieszeniu i zakończeniu)"
      />
      <div className="flex flex-wrap gap-2">
        {status !== "active" && (
          <Button type="button" size="sm" disabled={isPending} onClick={() => decide("active")}>
            {isPending ? "Chwileczkę…" : "Zweryfikuj — może dodawać auta"}
          </Button>
        )}
        {/* A missing or wrong document is a correction, not the end of the
            partnership — "Zakończ współpracę" used to be the only button that
            took a reason here. The company goes back to draft with the reason
            on its panel, and is told by notification and e-mail. */}
        {status === "pending" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => decide("draft")}
          >
            Poproś o poprawki
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
  // The result used to be thrown away, so a failure just put the button back
  // as if nothing had been clicked.
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await verifyPartnerDocument(documentId);
        if (result.error) setError(result.error);
      } catch {
        setError("Nie udało się zapisać — sprawdź połączenie i spróbuj ponownie.");
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? "…" : "Oznacz jako sprawdzony"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
