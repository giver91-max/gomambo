"use client";

import { useState, useTransition } from "react";
import { submitReview } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitReview(bookingId, rating, comment);
      if (result.error) {
        setError(result.error);
      } else {
        setSubmitted(true);
      }
    });
  }

  if (submitted) {
    return <p className="text-sm text-muted-foreground">Dziękujemy za opinię!</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Zostaw opinię</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            aria-label={`${value} gwiazdek`}
            className={cn(
              "text-2xl leading-none",
              value <= rating ? "text-primary" : "text-muted-foreground/40"
            )}
          >
            ★
          </button>
        ))}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Opcjonalny komentarz…"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={isPending || rating === 0}>
        {isPending ? "Wysyłanie…" : "Wyślij opinię"}
      </Button>
    </form>
  );
}
