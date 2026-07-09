import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import type { BookingStatus } from "@/types/database";

const statusLabel: Record<BookingStatus, string> = {
  requested: "Oczekuje na potwierdzenie",
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

export default async function RentalHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      `id, start_date, end_date, status, created_at,
       cars(id, brand, model, city)`
    )
    .eq("renter_id", user!.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Historia wypożyczeń</h1>

      {!bookings || bookings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych rezerwacji.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <Card key={booking.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base">
                  {booking.cars?.brand} {booking.cars?.model}
                </CardTitle>
                <Badge variant={statusVariant[booking.status]}>
                  {statusLabel[booking.status]}
                </Badge>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>{booking.cars?.city}</p>
                <p>
                  Termin: {booking.start_date} – {booking.end_date}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
