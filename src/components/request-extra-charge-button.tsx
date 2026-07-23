"use client";

import { useState, useTransition } from "react";
import { requestExtraCharge } from "@/app/dashboard/bookings/actions";
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

export function RequestExtraChargeButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
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
    if (!reason.trim()) {
      setError("Podaj powód dodatkowej opłaty.");
      return;
    }
    startTransition(async () => {
      const result = await requestExtraCharge(bookingId, parsed, reason);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setAmount("");
      setReason("");
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        Zgłoś dodatkową szkodę (ponad kaucję)
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Zgłosić dodatkową opłatę?</AlertDialogTitle>
          <AlertDialogDescription>
            Najemca dostanie prośbę o zapłatę tej kwoty osobną płatnością — to nie jest
            automatyczne obciążenie karty, więc musi ją sam potwierdzić.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="extra-charge-amount">Kwota (zł)</Label>
            <Input
              id="extra-charge-amount"
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="extra-charge-reason">Powód (widoczny dla najemcy)</Label>
            <Input
              id="extra-charge-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="np. koszt naprawy przekraczający kaucję"
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Wysyłanie…" : "Wyślij prośbę o dopłatę"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
