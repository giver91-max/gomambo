"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SUBMIT_FAILED_MESSAGE } from "@/app/(auth)/auth-errors";
import { confirmEmailLink } from "./actions";

export function ConfirmLinkForm({
  tokenHash,
  type,
  next,
  buttonLabel,
}: {
  tokenHash: string;
  type: string;
  next: string;
  buttonLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        // Redirects on success and on a dead link alike — it only comes back
        // here if the request itself never got an answer.
        await confirmEmailLink(formData);
      } catch {
        setError(SUBMIT_FAILED_MESSAGE);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Chwileczkę…" : buttonLabel}
      </Button>
    </form>
  );
}
