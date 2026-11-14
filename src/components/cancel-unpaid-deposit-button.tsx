"use client";

import { useState, useTransition } from "react";
import { ownerCancelForUnpaidDeposit } from "@/app/dashboard/bookings/actions";
import { Button } from "@/components/ui/button";
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

/**
 * The owner's choice when pickup day comes without a deposit. Never offered
 * earlier, never automatic (Rafał's rule): the renter may still pay, and
 * the owner decides whether to wait.
 */
export function CancelUnpaidDepositButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await ownerCancelForUnpaidDeposit(bookingId);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div className="space-y-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={<Button type="button" variant="outline" size="sm" className="text-destructive" />}
        >
          Odwołaj rezerwację — brak kaucji
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Odwołać rezerwację z powodu niewpłaconej kaucji?</AlertDialogTitle>
            <AlertDialogDescription>
              Najemca nie wpłacił kaucji w terminie. Odwołanie liczy się jak anulowanie przez
              najemcę: zwrot za wynajem wyliczymy według polityki anulowania tego auta. Najemca
              dostanie powiadomienie. Jeśli kaucja wpłynie w ostatniej chwili, rezerwacja zostanie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Poczekam</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Odwołuję…" : "Odwołaj rezerwację"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && !open && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
