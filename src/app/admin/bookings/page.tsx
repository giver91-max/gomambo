import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { CancelBookingButton } from "./cancel-booking-button";
import type { BookingStatus, DepositStatus, PaymentStatus } from "@/types/database";

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

const depositLabel: Record<DepositStatus, string> = {
  not_required: "Bez kaucji",
  held: "Zablokowana",
  captured: "Zatrzymana",
  released: "Zwolniona",
  failed: "Nieudana",
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
      `id, start_date, end_date, status, payment_status, deposit_status, total_price, deposit_amount, created_at,
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
    deposit_status: DepositStatus;
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
                  {booking.total_price ? ` (${Number(booking.total_price).toFixed(2)} zł)` : ""}
                  {" · "}Kaucja: {depositLabel[booking.deposit_status]}
                  {booking.deposit_amount ? ` (${Number(booking.deposit_amount).toFixed(2)} zł)` : ""}
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
