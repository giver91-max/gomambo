"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { acceptCurrentTerms } from "./actions";
import { Button } from "@/components/ui/button";
import { SUBMIT_FAILED_MESSAGE } from "@/app/(auth)/auth-errors";

export function AcceptTermsForm({ redirectTo }: { redirectTo: string }) {
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        // Redirects on success, so a result only ever comes back with an error.
        const result = await acceptCurrentTerms(redirectTo, accepted);
        if (result?.error) setError(result.error);
      } catch {
        // The checkbox stays ticked; one more click once the connection is back.
        setError(SUBMIT_FAILED_MESSAGE);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-4"
          disabled={isPending}
        />
        <span>
          Akceptuję{" "}
          <Link href="/regulamin" target="_blank" className="text-primary underline">
            Regulamin
          </Link>{" "}
          i{" "}
          <Link href="/polityka-prywatnosci" target="_blank" className="text-primary underline">
            Politykę prywatności
          </Link>
          .
        </span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={!accepted || isPending}>
        {isPending ? "Zapisywanie…" : "Akceptuję i przechodzę dalej"}
      </Button>
    </form>
  );
}
