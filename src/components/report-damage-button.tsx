"use client";

import { useState, useTransition } from "react";
import { reportDamage } from "@/app/dashboard/bookings/damage-report-actions";
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

export function ReportDamageButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    if (!description.trim()) {
      setError("Opisz, co się stało.");
      return;
    }
    startTransition(async () => {
      const result = await reportDamage(bookingId, description);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setDescription("");
      setSent(true);
    });
  }

  return (
    <div className="space-y-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
          Zgłoś problem
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zgłosić problem z tym wynajmem?</AlertDialogTitle>
            <AlertDialogDescription>
              Zgłoszenie trafi jednocześnie do drugiej strony i do obsługi GoMambo. Opisz, co
              się stało — im konkretniej, tym szybciej to rozstrzygniemy. Jeśli masz zdjęcia,
              dodaj je w sekcji zdjęć odbioru i zwrotu powyżej.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`damage-${bookingId}`}>Opis</Label>
            <textarea
              id={`damage-${bookingId}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={4000}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="Np. rysa na lewych drzwiach, której nie było przy odbiorze. Auto oddane 2 godziny po terminie."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Wysyłam…" : "Wyślij zgłoszenie"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {sent && (
        <p className="text-xs text-muted-foreground">
          Zgłoszenie wysłane — druga strona i GoMambo dostały powiadomienie.
        </p>
      )}
    </div>
  );
}
