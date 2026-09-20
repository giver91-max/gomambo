"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { adminCancelBooking } from "./actions";
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

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await adminCancelBooking(bookingId);
      setOpen(false);
      if (result?.error) {
        // A toast, not local state: the action revalidates /admin/bookings,
        // which re-renders this row without its cancel button — any message
        // held here would be unmounted before it could be read. Money may be
        // stuck in Stripe, so it must not auto-dismiss either.
        toast.error(result.error, { duration: Infinity, closeButton: true });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
        Anuluj rezerwację
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Anulować tę rezerwację?</AlertDialogTitle>
          <AlertDialogDescription>
            Zwolni zablokowaną kaucję (jeśli jest) i zwróci opłatę za wynajem, o ile rezerwacja
            jest jeszcze w oknie darmowego anulowania. Obie strony zostaną powiadomione.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Wróć</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Anulowanie…" : "Anuluj rezerwację"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
