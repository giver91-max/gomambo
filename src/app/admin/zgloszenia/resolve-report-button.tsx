"use client";

import { useState, useTransition } from "react";
import { resolveDamageReport } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notatka wewnętrzna (opcjonalnie)"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await resolveDamageReport(reportId, note);
            if (result?.error) setError(result.error);
          })
        }
      >
        {isPending ? "Zamykam…" : "Oznacz jako zamknięte"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
