"use client";

import { useState, useTransition } from "react";
import { deleteUserAccount } from "../actions";
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

export function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteUserAccount(userId);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>Usuń konto</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć konto {userName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Tej operacji nie można cofnąć. Zostaną trwale usunięte: profil, ogłoszenia aut,
            rezerwacje, wiadomości i opinie tego użytkownika — również te widoczne po drugiej
            stronie (np. opinia wystawiona przez najemcę zniknie razem z kontem właściciela).
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
