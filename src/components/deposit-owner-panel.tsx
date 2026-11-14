import { CaptureDepositButton } from "@/components/capture-deposit-button";
import { ConfirmVehicleOkButton } from "@/components/confirm-vehicle-ok-button";
import { CancelUnpaidDepositButton } from "@/components/cancel-unpaid-deposit-button";
import { settledOwnerShare, type DepositPanelRow } from "@/components/deposit-renter-panel";
import { formatDateTimePl, todayInPoland } from "@/lib/calendar";
import { DEPOSIT_REQUEST_LEAD_DAYS, DEPOSIT_REVIEW_DAYS, formatZl, roundPln } from "@/lib/deposit";

/**
 * The owner's side of the deposit: whether the car may be handed over, and
 * after return the two decisions — "it's fine" or "I keep part of it".
 */
export function DepositOwnerPanel({
  bookingId,
  bookingStatus,
  startDate,
  deposit,
  scheduledAmount,
}: {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  deposit: DepositPanelRow | null;
  scheduledAmount: number;
}) {
  const live = bookingStatus === "accepted" || bookingStatus === "completed";
  const pickupReached = startDate <= todayInPoland();

  if (!deposit) {
    if (!(scheduledAmount > 0) || bookingStatus !== "accepted") return null;
    return (
      <p className="rounded-md border p-3 text-xs">
        Kaucja {formatZl(scheduledAmount)} — najemca wpłaci ją {DEPOSIT_REQUEST_LEAD_DAYS} dni przed
        odbiorem. Nie wydawaj auta bez wpłaconej kaucji.
      </p>
    );
  }

  const amount = Number(deposit.amount);
  const kept = deposit.retained_amount !== null ? Number(deposit.retained_amount) : 0;
  const deadlinePassed = deposit.due_at !== null && new Date(deposit.due_at) <= new Date();

  switch (deposit.status) {
    case "requested":
    case "processing":
      if (bookingStatus !== "accepted") return null;
      return (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-foreground">
            Kaucja: czeka na wpłatę — nie wydawaj auta bez wpłaconej kaucji.
          </p>
          {deposit.status === "processing" && <p>Płatność najemcy jest w toku.</p>}
          {deposit.status === "requested" && pickupReached && (
            // The cancel button only once the renter's own deadline has
            // passed (ownerCancelForUnpaidDeposit checks the same): a trip
            // booked late is asked for the deposit on pickup day itself, and
            // gets a real window to pay from that moment.
            deadlinePassed ? (
              <>
                <p>
                  Najemca nie wpłacił kaucji w terminie. Może jeszcze to zrobić — dostaniesz
                  wiadomość. Jeśli nie chcesz czekać, możesz odwołać rezerwację; liczy się to jak
                  anulowanie przez najemcę.
                </p>
                <CancelUnpaidDepositButton bookingId={bookingId} />
              </>
            ) : (
              <p>
                Najemca ma czas na wpłatę do{" "}
                {deposit.due_at ? formatDateTimePl(deposit.due_at) : "—"} — dostaniesz wiadomość,
                gdy wpłaci. Jeśli nie zdąży, od tej chwili możesz odwołać rezerwację z powodu braku
                kaucji.
              </p>
            )
          )}
        </div>
      );
    case "paid":
      return (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
          <p className="font-medium text-foreground">Kaucja {formatZl(amount)} wpłacona.</p>
          {bookingStatus === "accepted" && (
            <p>
              Po zwrocie auta kliknij „Zakończ wypożyczenie” — od tej chwili masz{" "}
              {DEPOSIT_REVIEW_DAYS} dni na sprawdzenie auta, potem kaucja wróci do najemcy
              automatycznie.
            </p>
          )}
          {live && pickupReached && (
            <div className="flex flex-wrap gap-2">
              <ConfirmVehicleOkButton bookingId={bookingId} depositAmount={amount} />
              <CaptureDepositButton bookingId={bookingId} depositAmount={amount} />
            </div>
          )}
        </div>
      );
    case "in_review": {
      const open = deposit.review_deadline !== null && new Date(deposit.review_deadline) > new Date();
      return (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
          <p className="font-medium text-foreground">
            Sprawdź auto do {deposit.review_deadline ? formatDateTimePl(deposit.review_deadline) : "—"}.
            Potem kaucja wróci do najemcy automatycznie.
          </p>
          <div className="flex flex-wrap gap-2">
            <ConfirmVehicleOkButton bookingId={bookingId} depositAmount={amount} />
            {open && pickupReached && (
              <CaptureDepositButton bookingId={bookingId} depositAmount={amount} />
            )}
          </div>
        </div>
      );
    }
    case "retention_pending":
      return (
        <div className="space-y-1 rounded-md border p-3 text-xs">
          <p>
            Zatrzymano {formatZl(kept)} z kaucji:{" "}
            <span className="whitespace-pre-wrap">{deposit.retention_reason}</span>.
            {amount - kept > 0 ? ` Pozostałe ${formatZl(roundPln(amount - kept))} wraca do najemcy.` : ""}
          </p>
          <p>
            Najemca ma czas na sprzeciw do{" "}
            {deposit.objection_deadline ? formatDateTimePl(deposit.objection_deadline) : "—"}; potem
            przelejemy {formatZl(kept)} na Twoje konto wypłat.
          </p>
        </div>
      );
    case "retention_objected":
      return (
        <div className="space-y-1 rounded-md border p-3 text-xs">
          <p>
            Najemca nie zgadza się z zatrzymaniem {formatZl(kept)} — GoMambo rozstrzygnie sprawę i
            odezwie się.
          </p>
          {deposit.objection_comment && (
            <p className="whitespace-pre-wrap">Uzasadnienie najemcy: {deposit.objection_comment}</p>
          )}
        </div>
      );
    case "transferring":
      return (
        <p className="rounded-md border p-3 text-xs">
          Przelewamy {formatZl(Number(deposit.transfer_amount ?? kept))} z kaucji na Twoje konto
          wypłat.
        </p>
      );
    case "transfer_failed":
      return (
        <p className="rounded-md border border-destructive/40 p-3 text-xs">
          Przelew {formatZl(Number(deposit.transfer_amount ?? kept))} z kaucji czeka
          {deposit.transfer_failure_reason ? ` (${deposit.transfer_failure_reason})` : ""}. Sprawdź
          konfigurację wypłat w profilu — ponowimy go automatycznie.
        </p>
      );
    case "settled": {
      const { toOwner, settledByHand } = settledOwnerShare(deposit);
      return (
        <p className="rounded-md border p-3 text-xs">
          {toOwner > 0
            ? `Kaucja rozliczona — ${formatZl(toOwner)} przelaliśmy na Twoje konto wypłat.`
            : settledByHand
              ? "Kaucję rozliczyło GoMambo poza automatycznymi przelewami — pytania: kontakt@gomambo.pl."
              : "Kaucja rozliczona — wróciła do najemcy."}
        </p>
      );
    }
    case "disputed":
      return (
        <p className="rounded-md border p-3 text-xs">
          Płatność kaucji jest objęta reklamacją w banku najemcy — GoMambo się tym zajmuje.
        </p>
      );
    default:
      return null;
  }
}
