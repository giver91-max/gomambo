"use client";

import { useState, useTransition } from "react";
import { captureDepositForDamage } from "@/app/dashboard/bookings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEPOSIT_OBJECTION_DAYS, formatZl } from "@/lib/deposit";
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

export function CaptureDepositButton({
  bookingId,
  depositAmount,
}: {
  bookingId: string;
  depositAmount: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(depositAmount));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    const parsed = Number(amount);
    if (!(parsed > 0) || parsed > depositAmount) {
      setError(`Podaj kwotę od 0,01 do ${formatZl(depositAmount)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("Opisz szkodę — najemca i GoMambo zobaczą ten powód.");
      return;
    }
    startTransition(async () => {
      const result = await captureDepositForDamage(bookingId, parsed, reason);
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
        Zatrzymaj kaucję (szkoda)
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zatrzymać część kaucji?</AlertDialogTitle>
          <AlertDialogDescription>
            Kwota zostanie zatrzymana z wpłaconej kaucji (najwyżej {formatZl(depositAmount)}) i
            przelana na Twoje konto wypłat. Reszta od razu wróci do najemcy. Najemca ma{" "}
            {DEPOSIT_OBJECTION_DAYS} dni na sprzeciw — bez sprzeciwu przelejemy zatrzymaną kwotę,
            po sprzeciwie decyzję podejmie GoMambo. Zdjęcia szkody dodaj w sekcji zdjęć zwrotu.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`capture-amount-${bookingId}`}>Kwota do zatrzymania (zł)</Label>
            <Input
              id={`capture-amount-${bookingId}`}
              type="number"
              step="0.01"
              min={0}
              max={depositAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`capture-reason-${bookingId}`}>
              Powód (widoczny dla najemcy i GoMambo)
            </Label>
            <textarea
              id={`capture-reason-${bookingId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="np. rysa na tylnym zderzaku, której nie było na zdjęciach z odbioru"
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Przetwarzanie…" : "Zatrzymaj kaucję"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
