import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { CancelBookingButton } from "./cancel-booking-button";
import { DEPOSIT_STATE_LABELS, formatZl } from "@/lib/deposit";
import type { BookingStatus, DepositState, PaymentStatus } from "@/types/database";

const statusLabel: Record<BookingStatus, string> = {
  requested: "Oczekuje",
  accepted: "Zaakceptowana",
  declined: "Odrzucona",
  cancelled: "Anulowana",
  completed: "Zakończona",
};

const statusVariant: Record<BookingStatus, "secondary" | "default" | "destructive"> = {
  requested: "secondary",
  accepted: "default",
  declined: "destructive",
  cancelled: "destructive",
  completed: "secondary",
};

const paymentLabel: Record<PaymentStatus, string> = {
  unpaid: "Nieopłacona",
  paid: "Opłacona",
  refunded: "Zwrócona",
  partially_refunded: "Częściowo zwrócona",
  failed: "Płatność nieudana",
};

// Admin can't read arbitrary bookings through the session client —
// bookings_select_participant RLS is owner/renter-only, with no is_admin()
// bypass — so this reads through the service-role client, same as every
// other admin page that needs cross-user visibility.
export default async function AdminBookingsPage() {
  const admin = createAdminClient();

  const { data: rawBookings } = await admin
    .from("bookings")
    .select(
      `id, start_date, end_date, status, payment_status, total_price, deposit_amount, created_at,
       booking_deposits(status),
       cars(id, brand, model),
       owner:profiles!bookings_owner_id_fkey(full_name),
       renter:profiles!bookings_renter_id_fkey(full_name)`
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const bookings = (rawBookings ?? []) as unknown as {
    id: string;
    start_date: string;
    end_date: string;
    status: BookingStatus;
    payment_status: PaymentStatus;
    // One-to-one (booking_id is the key), so PostgREST returns an object;
    // read defensively in case it ever comes back as a one-element list.
    booking_deposits: { status: DepositState } | { status: DepositState }[] | null;
    total_price: number | null;
    deposit_amount: number | null;
    created_at: string;
    cars: { id: string; brand: string; model: string } | null;
    owner: { full_name: string } | null;
    renter: { full_name: string } | null;
  }[];

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Rezerwacje</h1>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Brak rezerwacji.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <Card key={booking.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base">
                  {booking.cars?.brand} {booking.cars?.model} —{" "}
                  {booking.owner?.full_name ?? "?"} / {booking.renter?.full_name ?? "?"}
                </CardTitle>
                <Badge variant={statusVariant[booking.status]}>{statusLabel[booking.status]}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Termin: {booking.start_date} – {booking.end_date}
                </p>
                <p>
                  Płatność: {paymentLabel[booking.payment_status]}
                  {booking.total_price ? ` (${formatZl(Number(booking.total_price))})` : ""}
                  {" · "}Kaucja:{" "}
                  {booking.deposit_amount && Number(booking.deposit_amount) > 0 ? (
                    <Link href="/admin/kaucje" className="text-primary hover:underline">
                      {formatZl(Number(booking.deposit_amount))} —{" "}
                      {(() => {
                        const row = Array.isArray(booking.booking_deposits)
                          ? booking.booking_deposits[0]
                          : booking.booking_deposits;
                        return row ? DEPOSIT_STATE_LABELS[row.status] : "jeszcze nie pobrana";
                      })()}
                    </Link>
                  ) : (
                    "brak"
                  )}
                </p>
                {(booking.status === "requested" || booking.status === "accepted") && (
                  <CancelBookingButton bookingId={booking.id} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
