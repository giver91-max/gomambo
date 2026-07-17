"use client";

import { useState, useTransition } from "react";
import { deleteOwnAccount } from "./delete-account-actions";
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

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteOwnAccount();
      if (result?.error) {
        setError(result.error);
      }
      // On success the action redirects — nothing left to do here.
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
        Usuń konto
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć swoje konto?</AlertDialogTitle>
          <AlertDialogDescription>
            Tej operacji nie można cofnąć. Usunięte zostaną Twoje ogłoszenia, rezerwacje,
            wiadomości, opinie i dokumenty. Jeśli masz aktywny wynajem lub oczekującą wypłatę,
            dokończ go najpierw — usunięcie konta go nie zatrzyma ani nie rozliczy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Usuwanie…" : "Usuń konto"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
