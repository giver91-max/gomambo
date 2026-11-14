import type { BookingDeposit } from "@/types/database";
import { PayDepositButton } from "@/components/pay-deposit-button";
import { DepositObjectionButton } from "@/components/deposit-objection-button";
import { formatDatePl, formatDateTimePl, todayInPoland } from "@/lib/calendar";
import {
  DEPOSIT_REQUEST_LEAD_DAYS,
  DEPOSIT_REVIEW_DAYS,
  depositDueText,
  formatZl,
  roundPln,
} from "@/lib/deposit";

export type DepositPanelRow = Pick<
  BookingDeposit,
  | "status"
  | "amount"
  | "fee_amount"
  | "due_at"
  | "review_deadline"
  | "retained_amount"
  | "retention_reason"
  | "objection_deadline"
  | "objection_comment"
  | "transfer_amount"
  | "transfer_failure_reason"
  | "transfer_reversed_at"
  | "stripe_transfer_id"
  | "decision"
  | "refund_amount"
  | "refund_status"
  | "refund_requested_at"
  | "payment_method_type"
>;

export const DEPOSIT_PANEL_COLUMNS =
  "booking_id, status, amount, fee_amount, due_at, review_deadline, retained_amount, retention_reason, objection_deadline, objection_comment, transfer_amount, transfer_failure_reason, transfer_reversed_at, stripe_transfer_id, decision, refund_amount, refund_status, refund_requested_at, payment_method_type";

/**
 * What a settled deposit passed to the owner — only a transfer actually
 * recorded and not reversed. "settledByHand": an amount was meant for the
 * owner but GoMambo closed the case outside the app (no transfer on record),
 * so neither side is told where that money went.
 */
export function settledOwnerShare(deposit: DepositPanelRow): { toOwner: number; settledByHand: boolean } {
  const intended = Number(deposit.transfer_amount ?? 0);
  if (deposit.stripe_transfer_id) {
    return { toOwner: deposit.transfer_reversed_at ? 0 : intended, settledByHand: false };
  }
  return { toOwner: 0, settledByHand: deposit.decision === "admin" && intended > 0 };
}

function refundLine(deposit: DepositPanelRow): string | null {
  const amount = Number(deposit.refund_amount);
  if (!(amount > 0) || !deposit.refund_status) return null;
  if (deposit.refund_status === "succeeded") return `Kaucja zwrócona: ${formatZl(amount)}.`;
  if (deposit.refund_status === "failed") {
    return `Zwrot ${formatZl(amount)} się opóźnia — zajmujemy się tym, nie musisz nic robić.`;
  }
  const when = deposit.refund_requested_at ? ` ${formatDatePl(deposit.refund_requested_at)}` : "";
  const timing =
    deposit.payment_method_type === "blik"
      ? "BLIK zwykle do 2 godzin"
      : deposit.payment_method_type === "card"
        ? "karta do 10 dni roboczych"
        : "BLIK zwykle do 2 godzin, karta do 10 dni roboczych";
  return `Zwrot kaucji ${formatZl(amount)} zlecony${when} — ${timing}.`;
}

/**
 * What the renter sees about their deposit, in every state it can be in.
 * Server-rendered, so every date is shown in Polish time whatever the
 * browser's zone; only the two buttons are client code.
 */
export function DepositRenterPanel({
  bookingId,
  bookingStatus,
  startDate,
  endDate,
  deposit,
  scheduled,
}: {
  bookingId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  deposit: DepositPanelRow | null;
  /** The pinned amounts, for a deposit not asked for yet. */
  scheduled: { amount: number; fee: number };
}) {
  if (!deposit) {
    if (!(scheduled.amount > 0) || bookingStatus !== "accepted") return null;
    return (
      <p className="rounded-md border p-3 text-xs">
        Kaucja {formatZl(scheduled.amount)} (zwrotna) + {formatZl(scheduled.fee)} opłaty za obsługę
        kaucji — poprosimy o nią {DEPOSIT_REQUEST_LEAD_DAYS} dni przed odbiorem, płatność kartą lub
        BLIK-iem.
      </p>
    );
  }

  const amount = Number(deposit.amount);
  const fee = Number(deposit.fee_amount);
  const kept = deposit.retained_amount !== null ? Number(deposit.retained_amount) : 0;
  const refund = refundLine(deposit);

  switch (deposit.status) {
    case "requested": {
      if (bookingStatus !== "accepted") return null;
      const today = todayInPoland();
      // A trip that is over needs no deposit any more; the daily job closes
      // this one, and payDeposit refuses it meanwhile.
      if (endDate < today) {
        return (
          <p className="rounded-md border p-3 text-xs">
            Wynajem się zakończył — kaucji nie trzeba już wpłacać.
          </p>
        );
      }
      const due = depositDueText(startDate, deposit.due_at, today);
      return (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-foreground">Wpłać kaucję przed odbiorem</p>
          <p className="text-xs">
            Kaucja {formatZl(amount)} (zwrotna) + {formatZl(fee)} opłaty za obsługę kaucji
            (bezzwrotnej). Termin: {due}.
          </p>
          <p className="text-xs font-medium text-foreground">
            Bez kaucji nie wyślemy Ci danych do odbioru.
          </p>
          <p className="text-xs">
            Kaucja wraca do Ciebie po zwrocie auta: zwrot zlecimy od razu, gdy właściciel
            potwierdzi, że auto jest w porządku, a najpóźniej {DEPOSIT_REVIEW_DAYS + 1} dni po
            zakończeniu wynajmu, jeśli nie zgłosi szkody (BLIK zwykle do 2 godzin, karta do 10 dni
            roboczych).
          </p>
          <PayDepositButton bookingId={bookingId} totalPln={roundPln(amount + fee)} />
        </div>
      );
    }
    case "processing":
      return (
        <p className="rounded-md border p-3 text-xs">
          Płatność kaucji jest przetwarzana — damy znać, gdy dotrze. Odśwież stronę za chwilę.
        </p>
      );
    case "paid":
      return (
        <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
          Kaucja wpłacona — wróci po zwrocie auta.
        </p>
      );
    case "in_review":
      return (
        <p className="rounded-md border p-3 text-xs">
          Wynajem zakończony. Właściciel ma czas do{" "}
          {deposit.review_deadline ? formatDateTimePl(deposit.review_deadline) : "—"} na sprawdzenie
          auta — potem automatycznie zlecimy zwrot kaucji {formatZl(amount)}.
        </p>
      );
    case "retention_pending": {
      const open =
        deposit.objection_deadline !== null && new Date(deposit.objection_deadline) > new Date();
      return (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-xs">
          <p>
            Właściciel zatrzymał <strong>{formatZl(kept)}</strong> z kaucji:{" "}
            <span className="whitespace-pre-wrap">{deposit.retention_reason}</span>.
            {amount - kept > 0 ? ` Pozostałe ${formatZl(roundPln(amount - kept))} zwracamy.` : ""}
          </p>
          {refund && <p>{refund}</p>}
          {open ? (
            <>
              <p>
                Nie zgadzasz się? Zgłoś sprzeciw do{" "}
                {formatDateTimePl(deposit.objection_deadline!)} — wtedy decyzję podejmie GoMambo.
                Bez sprzeciwu przekażemy zatrzymaną kwotę właścicielowi.
              </p>
              <DepositObjectionButton bookingId={bookingId} />
            </>
          ) : (
            <p>Termin na sprzeciw minął — zatrzymaną kwotę przekazujemy właścicielowi.</p>
          )}
        </div>
      );
    }
    case "retention_objected":
      return (
        <div className="space-y-1 rounded-md border p-3 text-xs">
          <p>
            Właściciel zatrzymał <strong>{formatZl(kept)}</strong> z kaucji:{" "}
            <span className="whitespace-pre-wrap">{deposit.retention_reason}</span>.
          </p>
          <p>Zgłoszono sprzeciw — GoMambo rozstrzygnie sprawę i odezwie się do Ciebie.</p>
          {refund && <p>{refund}</p>}
        </div>
      );
    case "transferring":
    case "transfer_failed":
      return (
        <div className="space-y-1 rounded-md border p-3 text-xs">
          <p>
            Zatrzymane {formatZl(Number(deposit.transfer_amount ?? kept))} z kaucji przekazujemy
            właścicielowi.
          </p>
          {refund && <p>{refund}</p>}
        </div>
      );
    case "settled": {
      const { toOwner, settledByHand } = settledOwnerShare(deposit);
      if (!refund && !(toOwner > 0) && !settledByHand) return null;
      return (
        <div className="space-y-1 rounded-md border p-3 text-xs">
          {toOwner > 0 && (
            <p>Właściciel otrzymał {formatZl(toOwner)} z kaucji na pokrycie szkody.</p>
          )}
          {settledByHand && <p>Kaucję rozliczyło GoMambo.</p>}
          {refund && <p>{refund}</p>}
        </div>
      );
    }
    case "disputed":
      return (
        <p className="rounded-md border p-3 text-xs">
          Płatność kaucji jest objęta reklamacją w Twoim banku — rozliczymy ją po jej zakończeniu.
        </p>
      );
    default:
      return null;
  }
}
