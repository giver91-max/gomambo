import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { BookingActions } from "./booking-actions";
import type { BookingStatus } from "@/types/database";

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

export default async function OwnerBookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(
      `id, start_date, end_date, status, created_at,
       cars(id, brand, model),
       renter:profiles!bookings_renter_id_fkey(full_name)`
    )
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: false });

  const bookings = (rawBookings ?? []) as unknown as {
    id: string;
    start_date: string;
    end_date: string;
    status: BookingStatus;
    created_at: string;
    cars: { id: string; brand: string; model: string } | null;
    renter: { full_name: string } | null;
  }[];

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Zapytania o wynajem</h1>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych zapytań o wynajem.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <Card key={booking.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base">
                  {booking.cars?.brand} {booking.cars?.model} — {booking.renter?.full_name}
                </CardTitle>
                <Badge variant={statusVariant[booking.status]}>
                  {statusLabel[booking.status]}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Termin: {booking.start_date} – {booking.end_date}
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  {booking.status === "requested" && <BookingActions bookingId={booking.id} />}
                  <Link
                    href={`/dashboard/messages`}
                    className="text-sm text-primary hover:underline"
                  >
                    Wiadomości →
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
