"use client";

import { useState, useTransition } from "react";
import { captureDepositForDamage } from "@/app/dashboard/bookings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    if (!(parsed > 0)) {
      setError("Podaj kwotę większą od zera.");
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
        Zatrzymaj kaucję (zgłoszono szkodę)
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zatrzymać kaucję?</AlertDialogTitle>
          <AlertDialogDescription>
            Kwota zostanie pobrana z zablokowanej kaucji najemcy (max{" "}
            {depositAmount.toFixed(2)} zł) i przekazana na Twoje konto. Najemca zostanie o
            tym powiadomiony.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="capture-amount">Kwota (zł)</Label>
            <Input
              id="capture-amount"
              type="number"
              step="0.01"
              min={0}
              max={depositAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capture-reason">Powód (widoczny dla najemcy)</Label>
            <Input
              id="capture-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="np. rysa na zderzaku przy zwrocie"
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
