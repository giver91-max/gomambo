"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatZl } from "@/lib/deposit";
import type { DepositRefundStatus, DepositState } from "@/types/database";
import {
  adminExtendDepositWindow,
  adminMarkDepositSettled,
  adminRefundDepositFee,
  adminResolveRetention,
  adminReverseDepositTransfer,
  adminRetryDepositRefund,
  adminRetryDepositTransfer,
} from "./actions";

export function DepositAdminActions({
  bookingId,
  status,
  refundStatus,
  retainedAmount,
  decidableAmount,
  canReverseTransfer,
  refundableFee,
}: {
  bookingId: string;
  status: DepositState;
  refundStatus: DepositRefundStatus | null;
  /** What the owner kept, as claimed. */
  retainedAmount: number | null;
  /**
   * What is still to be decided (decidableRetention): the kept part, or —
   * after a failed transfer — only the amount that transfer was carrying.
   */
  decidableAmount: number | null;
  canReverseTransfer: boolean;
  /** The handling fee a cancelled booking kept and could still return, or null. */
  refundableFee: number | null;
}) {
  const [ownerAmount, setOwnerAmount] = useState(String(decidableAmount ?? 0));
  const [isPending, startTransition] = useTransition();

  // A toast, not local state: every action revalidates the page and this
  // card may re-render without the button that was clicked.
  function run(action: () => Promise<{ error: string | null }>, success: string, ask?: string) {
    if (ask && !confirm(ask)) return;
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        toast.error(result.error, { duration: Infinity, closeButton: true });
      } else {
        toast.success(success);
      }
    });
  }

  const resolvable =
    decidableAmount !== null &&
    (status === "retention_pending" || status === "retention_objected" || status === "transfer_failed");
  const decidable = decidableAmount ?? 0;
  const closable =
    status === "disputed" || status === "transfer_failed" || (status === "settled" && refundStatus === "failed");

  return (
    <div className="space-y-3 border-t pt-3">
      {resolvable && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">
            {status === "transfer_failed"
              ? `Decyzja: nieudany przelew ${formatZl(decidable)}${
                  retainedAmount !== null && retainedAmount !== decidable
                    ? ` (z zatrzymanych ${formatZl(retainedAmount)})`
                    : ""
                } — ile dla właściciela? Reszta wróci do najemcy.`
              : `Decyzja: zatrzymane ${formatZl(decidable)} — ile dla właściciela? Reszta wróci do najemcy.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              step="0.01"
              min={0}
              max={decidable}
              value={ownerAmount}
              onChange={(e) => setOwnerAmount(e.target.value)}
              className="h-8 w-32"
            />
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(
                  () => adminResolveRetention(bookingId, Number(ownerAmount)),
                  "Decyzja zapisana.",
                  `Właściciel dostanie ${formatZl(Number(ownerAmount) || 0)}, najemca odzyska ${formatZl(
                    Math.max(0, decidable - (Number(ownerAmount) || 0))
                  )}. Obie strony zostaną powiadomione. Kontynuować?`
                )
              }
            >
              Zatwierdź podział
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(
                  () => adminResolveRetention(bookingId, decidable),
                  "Przelew do właściciela zlecony.",
                  `Przelać całe ${formatZl(decidable)} właścicielowi?`
                )
              }
            >
              Całość właścicielowi
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(
                  () => adminResolveRetention(bookingId, 0),
                  "Zwrot najemcy zlecony.",
                  `Zwrócić całe ${formatZl(decidable)} najemcy?`
                )
              }
            >
              Całość najemcy
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {refundStatus === "failed" && status !== "disputed" && (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => run(() => adminRetryDepositRefund(bookingId), "Zwrot zlecony ponownie.")}
          >
            Ponów zwrot
          </Button>
        )}
        {status === "transfer_failed" && (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => run(() => adminRetryDepositTransfer(bookingId), "Przelew zlecony ponownie.")}
          >
            Ponów przelew
          </Button>
        )}
        {(status === "in_review" || status === "retention_pending") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => adminExtendDepositWindow(bookingId), "Termin przedłużony.")}
          >
            Przedłuż termin o 3 dni
          </Button>
        )}
        {canReverseTransfer && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => adminReverseDepositTransfer(bookingId),
                "Przelew cofnięty, zwrot najemcy zlecony.",
                "Cofnąć przelew zatrzymanej kaucji z konta właściciela i zwrócić tę kwotę najemcy? Uda się tylko, jeśli właściciel ma jeszcze te środki na saldzie Stripe."
              )
            }
          >
            Cofnij przelew i zwróć najemcy
          </Button>
        )}
        {refundableFee !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => adminRefundDepositFee(bookingId),
                "Zwrot opłaty zlecony.",
                `Zwrócić najemcy opłatę za obsługę kaucji (${formatZl(refundableFee)})? Rób to tylko wtedy, gdy rezerwacji nie anulował najemca.`
              )
            }
          >
            Zwróć opłatę za obsługę
          </Button>
        )}
        {closable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => adminMarkDepositSettled(bookingId),
                "Oznaczono jako rozliczoną.",
                "Oznaczyć kaucję jako rozliczoną ręcznie? Aplikacja nie przeleje ani nie zwróci już niczego automatycznie — zrób to tylko, gdy pieniądze zostały rozliczone poza nią (np. przelewem albo decyzją banku w sporze)."
              )
            }
          >
            Oznacz jako rozliczoną ręcznie
          </Button>
        )}
      </div>
    </div>
  );
}
