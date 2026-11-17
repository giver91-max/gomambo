import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { formatZl } from "@/lib/deposit";
import { ConfirmTransferButton } from "./confirm-transfer-button";

// Amounts to match against the bank statement: formatZl drops the pointless
// ".00" but keeps real grosze (a 10% fee can produce them), never rounds.

export default async function AdminTransfersPage() {
  const admin = createAdminClient();

  const [{ data: bookings }, { data: extraCharges }] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id, start_date, end_date, total_price, platform_fee_amount, cars(brand, model), renter:profiles!bookings_renter_id_fkey(full_name)"
      )
      .eq("payment_method", "bank_transfer")
      .eq("payment_status", "unpaid")
      // Cancelled/declined only: a booking the owner has already marked
      // finished is still owed the money — the trip happened. Transfers
      // routinely land after the last day.
      .in("status", ["accepted", "completed"])
      .order("created_at", { ascending: true }),
    admin
      .from("booking_extra_charges")
      .select(
        "id, amount_pln, reason, created_at, bookings!inner(status, cars(brand, model), renter:profiles!bookings_renter_id_fkey(full_name))"
      )
      .eq("payment_method", "bank_transfer")
      .eq("status", "requested")
      .in("bookings.status", ["accepted", "completed"])
      .order("created_at", { ascending: true }),
  ]);

  const bookingRows = (bookings ?? []) as unknown as {
    id: string;
    start_date: string;
    end_date: string;
    total_price: number | null;
    platform_fee_amount: number | null;
    cars: { brand: string; model: string } | null;
    renter: { full_name: string } | null;
  }[];

  const chargeRows = (extraCharges ?? []) as unknown as {
    id: string;
    amount_pln: number;
    reason: string;
    bookings: {
      cars: { brand: string; model: string } | null;
      renter: { full_name: string } | null;
    } | null;
  }[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Przelewy do potwierdzenia</h1>
        <p className="text-sm text-muted-foreground">
          Najemca zadeklarował płatność przelewem. Potwierdź dopiero, gdy pieniądze faktycznie
          wpłynęły — potwierdzenie oznacza rezerwację jako opłaconą i powiadamia właściciela.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Wynajmy ({bookingRows.length})</h2>
        {bookingRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak przelewów oczekujących na potwierdzenie.</p>
        ) : (
          bookingRows.map((booking) => (
            <Card key={booking.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {booking.cars ? `${booking.cars.brand} ${booking.cars.model}` : "Auto"} —{" "}
                  {booking.total_price ? formatZl(Number(booking.total_price)) : "? zł"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Najemca: {booking.renter?.full_name || "—"}</p>
                <p>
                  Termin: {booking.start_date} – {booking.end_date}
                </p>
                <p className="text-xs">
                  W tym opłata serwisowa:{" "}
                  {formatZl(Number(booking.platform_fee_amount ?? 0))}
                  {" · "}tytuł przelewu: <code className="font-mono">{booking.id.slice(0, 8)}</code>
                </p>
                <ConfirmTransferButton id={booking.id} kind="booking" />
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Dopłaty ({chargeRows.length})</h2>
        {chargeRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak dopłat oczekujących na potwierdzenie.</p>
        ) : (
          chargeRows.map((charge) => (
            <Card key={charge.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {charge.bookings?.cars
                    ? `${charge.bookings.cars.brand} ${charge.bookings.cars.model}`
                    : "Auto"}{" "}
                  — {formatZl(Number(charge.amount_pln))}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Najemca: {charge.bookings?.renter?.full_name || "—"}</p>
                <p>Powód: {charge.reason}</p>
                <p className="text-xs">
                  Tytuł przelewu: <code className="font-mono">{charge.id.slice(0, 8)}</code>
                </p>
                <ConfirmTransferButton id={charge.id} kind="extra_charge" />
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
