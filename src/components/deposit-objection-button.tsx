"use client";

import { useState, useTransition } from "react";
import { objectDepositRetention } from "@/app/dashboard/rentals/deposit-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DepositObjectionButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    if (!comment.trim()) {
      setError("Napisz, dlaczego się nie zgadzasz.");
      return;
    }
    startTransition(async () => {
      const result = await objectDepositRetention(bookingId, comment);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        Nie zgadzam się
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sprzeciw wobec zatrzymania kaucji</AlertDialogTitle>
          <AlertDialogDescription>
            Zatrzymana kwota zostanie u nas, a decyzję podejmie GoMambo — przeczytamy Twoje
            uzasadnienie i obejrzymy zdjęcia z odbioru i zwrotu. Jeśli masz własne zdjęcia,
            dodaj je w sekcji zdjęć tej rezerwacji.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`objection-${bookingId}`}>Dlaczego się nie zgadzasz?</Label>
          <textarea
            id={`objection-${bookingId}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={5}
            maxLength={2000}
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="Np. rysa była już przy odbiorze — widać ją na zdjęciu z odbioru."
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Wróć</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Wysyłam…" : "Zgłoś sprzeciw"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
