"use client";

import { useState, useTransition } from "react";
import { deleteCar } from "./actions";
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

const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

export function DeleteCarButton({
  carId,
  redirectTo,
}: {
  carId: string;
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      // deleteCar redirects on success, so only a returned error is a
      // failure; a thrown one (dropped connection) is caught so it cannot
      // rethrow into Next's bare "Application error" screen.
      try {
        const result = await deleteCar(carId, redirectTo);
        if (result?.error) {
          setError(result.error);
        }
      } catch (err) {
        console.error("delete car", err);
        setError(CONNECTION_FAILED);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
        Usuń auto
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć to auto?</AlertDialogTitle>
          <AlertDialogDescription>
            Tej operacji nie można cofnąć. Ogłoszenie oraz wszystkie jego zdjęcia
            zostaną trwale usunięte.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Usuwanie…" : "Usuń auto"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
