import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import {
  DEPOSIT_ADMIN_STATES,
  DEPOSIT_STATE_LABELS,
  decidableRetention,
  formatZl,
} from "@/lib/deposit";
import { formatDateTimePl } from "@/lib/calendar";
import type { BookingDeposit, DepositRefundStatus } from "@/types/database";
import { DepositAdminActions } from "./deposit-admin-actions";

const refundLabel: Record<DepositRefundStatus, string> = {
  pending: "zwrot w drodze",
  succeeded: "zwrot zakończony",
  failed: "ZWROT NIEUDANY",
};

const VIEWS = {
  decyzje: "Do decyzji",
  aktywne: "Wszystkie otwarte",
  rozliczone: "Rozliczone",
} as const;
type View = keyof typeof VIEWS;

type DepositCase = BookingDeposit & {
  bookings: {
    id: string;
    start_date: string;
    end_date: string;
    status: string;
    cars: { brand: string; model: string; year: number } | null;
    owner: { full_name: string } | null;
    renter: { full_name: string } | null;
  } | null;
};

// Service role: the deposit row would be readable by an admin through RLS,
// but the joins reach bookings and profiles, which have no admin SELECT
// policy. /admin/* is gated by middleware and the admin layout, and every
// action re-checks the role.
export default async function AdminDepositsPage({
  searchParams,
}: {
  searchParams: { widok?: string };
}) {
  const view: View =
    searchParams.widok === "aktywne" || searchParams.widok === "rozliczone"
      ? searchParams.widok
      : "decyzje";
  const admin = createAdminClient();

  let query = admin
    .from("booking_deposits")
    .select(
      `*, bookings(id, start_date, end_date, status, cars(brand, model, year),
         owner:profiles!bookings_owner_id_fkey(full_name),
         renter:profiles!bookings_renter_id_fkey(full_name))`
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (view === "decyzje") {
    // What nothing automatic will move on: objections, failed transfers,
    // bank disputes, and refunds that keep failing.
    query = query.or(`status.in.(${DEPOSIT_ADMIN_STATES.join(",")}),refund_status.eq.failed`);
  } else if (view === "aktywne") {
    query = query.not("status", "in", "(settled,voided)");
  } else {
    query = query.in("status", ["settled", "voided"]);
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as DepositCase[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Kaucje</h1>
        <p className="text-sm text-muted-foreground">
          Kaucje są pobierane na saldo GoMambo i zwracane albo przekazywane właścicielowi po
          rozliczeniu. Tu trafia wszystko, czego automat nie rozstrzygnie sam: sprzeciwy najemców,
          nieudane zwroty i przelewy, spory w banku.
        </p>
      </div>

      <div className="flex gap-2 border-b">
        {(Object.keys(VIEWS) as View[]).map((key) => (
          <Link
            key={key}
            href={key === "decyzje" ? "/admin/kaucje" : `/admin/kaucje?widok=${key}`}
            className={`px-3 py-2 text-sm ${
              view === key ? "border-b-2 border-primary font-medium" : "text-muted-foreground"
            }`}
          >
            {VIEWS[key]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nic tu teraz nie ma.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const booking = row.bookings;
            const car = booking?.cars;
            const label = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
            const amount = Number(row.amount);
            const needsAdmin =
              DEPOSIT_ADMIN_STATES.includes(row.status) || row.refund_status === "failed";
            const decidable = row.retained_amount !== null ? decidableRetention(row) : null;
            return (
              <Card key={row.booking_id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">{label}</CardTitle>
                  <Badge variant={needsAdmin ? "destructive" : "secondary"}>
                    {DEPOSIT_STATE_LABELS[row.status]}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p className="text-xs">
                    Właściciel: {booking?.owner?.full_name || "—"} · najemca:{" "}
                    {booking?.renter?.full_name || "—"} · termin {booking?.start_date} –{" "}
                    {booking?.end_date} · rezerwacja: {booking?.status ?? "usunięta"}
                  </p>
                  <p>
                    Kaucja {formatZl(amount)} + opłata {formatZl(Number(row.fee_amount))}
                    {row.paid_amount !== null ? ` · wpłacono ${formatZl(Number(row.paid_amount))}` : ""}
                    {row.payment_method_type ? ` (${row.payment_method_type})` : ""}
                    {row.paid_at ? ` · ${formatDateTimePl(row.paid_at)}` : ""}
                  </p>
                  {Number(row.refund_amount) > 0 && (
                    <p>
                      Do zwrotu najemcy łącznie {formatZl(Number(row.refund_amount))}
                      {row.refund_status ? ` — ${refundLabel[row.refund_status]}` : ""}
                      {row.refund_failure_reason ? ` (${row.refund_failure_reason})` : ""}
                    </p>
                  )}
                  {row.review_deadline && row.status === "in_review" && (
                    <p>Właściciel sprawdza auto do {formatDateTimePl(row.review_deadline)}.</p>
                  )}
                  {row.retained_amount !== null && (
                    <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-foreground">
                      <p>
                        <strong>Zatrzymano {formatZl(Number(row.retained_amount))}</strong>
                        {row.retained_at ? ` (${formatDateTimePl(row.retained_at)})` : ""}
                        {row.objection_deadline
                          ? ` · sprzeciw do ${formatDateTimePl(row.objection_deadline)}`
                          : ""}
                      </p>
                      <p className="whitespace-pre-wrap">Powód właściciela: {row.retention_reason}</p>
                      {row.objection_comment && (
                        <p className="whitespace-pre-wrap">
                          Sprzeciw najemcy
                          {row.objected_at ? ` (${formatDateTimePl(row.objected_at)})` : ""}:{" "}
                          {row.objection_comment}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Zdjęcia z odbioru i zwrotu oraz zgłoszenie właściciela:{" "}
                        <Link href="/admin/zgloszenia" className="text-primary hover:underline">
                          zgłoszenia
                        </Link>
                        .
                      </p>
                    </div>
                  )}
                  {row.transfer_amount !== null && (
                    <p>
                      Dla właściciela {formatZl(Number(row.transfer_amount))}
                      {row.transferred_at ? ` · przelano ${formatDateTimePl(row.transferred_at)}` : ""}
                      {row.transfer_failure_reason ? ` · ${row.transfer_failure_reason}` : ""}
                      {row.transfer_reversed_at
                        ? ` · przelew cofnięty ${formatDateTimePl(row.transfer_reversed_at)}`
                        : ""}
                    </p>
                  )}
                  {row.stripe_dispute_id && (
                    <p className="text-destructive">
                      Spór w banku: {row.stripe_dispute_id}
                      {row.disputed_at ? ` (${formatDateTimePl(row.disputed_at)})` : ""}
                    </p>
                  )}
                  <p className="font-mono text-xs">
                    rezerwacja {row.booking_id}
                    {row.stripe_payment_intent_id ? ` · ${row.stripe_payment_intent_id}` : ""}
                    {row.stripe_refund_id ? ` · ${row.stripe_refund_id}` : ""}
                    {row.stripe_transfer_id ? ` · ${row.stripe_transfer_id}` : ""}
                  </p>
                  <DepositAdminActions
                    // Keyed by state and amount: the amount field keeps its own
                    // state, which must start again from the new amount when a
                    // decision moves the row on.
                    key={`${row.status}:${decidable ?? ""}`}
                    bookingId={row.booking_id}
                    status={row.status}
                    refundStatus={row.refund_status}
                    retainedAmount={row.retained_amount !== null ? Number(row.retained_amount) : null}
                    decidableAmount={decidable}
                    canReverseTransfer={
                      row.status === "settled" &&
                      !!row.stripe_transfer_id &&
                      !row.transfer_reversed_at &&
                      Number(row.transfer_amount ?? 0) > 0
                    }
                    // The same test refundDepositFee makes: a cancelled
                    // booking's deposit whose fee was kept and is still on
                    // the payment to give back.
                    refundableFee={
                      row.status === "settled" &&
                      (row.decision === "cancelled" || row.decision === "late_payment") &&
                      row.refund_status !== "failed" &&
                      Number(row.fee_amount) > 0 &&
                      Number(row.paid_amount ?? 0) - Number(row.refund_amount) + 0.005 >=
                        Number(row.fee_amount)
                        ? Number(row.fee_amount)
                        : null
                    }
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
