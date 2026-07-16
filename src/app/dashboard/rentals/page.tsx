import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { cancelBooking } from "../bookings/actions";
import { ReviewForm } from "../bookings/review-form";
import { TripPhotosManager, type TripPhotoItem } from "@/components/trip-photos-manager";
import { PayBookingButton } from "@/components/pay-booking-button";
import type { BookingStatus, CancellationPolicy } from "@/types/database";
import { CANCELLATION_POLICY_LABELS } from "@/lib/car-options";
import { freeCancellationDeadline, isWithinFreeCancellationWindow } from "@/lib/cancellation";

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
       pickup_odometer_km, pickup_fuel_level, return_odometer_km, return_fuel_level,
       payment_status, deposit_status, total_price, deposit_amount,
       cars(id, brand, model, city, cancellation_policy)`
    )
    .eq("renter_id", user!.id)
    .order("created_at", { ascending: false });

  const completedIds = (bookings ?? [])
    .filter((b) => b.status === "completed")
    .map((b) => b.id);
  let reviewedBookingIds = new Set<string>();
  if (completedIds.length > 0) {
    const { data: reviews } = await supabase
      .from("reviews")
      .select("booking_id")
      .eq("reviewer_id", user!.id)
      .in("booking_id", completedIds);
    reviewedBookingIds = new Set((reviews ?? []).map((r) => r.booking_id));
  }

  const activeBookingIds = (bookings ?? [])
    .filter((b) => b.status === "accepted" || b.status === "completed")
    .map((b) => b.id);
  const tripPhotosByBooking = new Map<string, { pickup: TripPhotoItem[]; return: TripPhotoItem[] }>();
  if (activeBookingIds.length > 0) {
    const { data: photos } = await supabase
      .from("trip_photos")
      .select("id, booking_id, uploader_id, stage, storage_path")
      .in("booking_id", activeBookingIds);
    for (const photo of photos ?? []) {
      const { data: signed } = await supabase.storage
        .from("trip-photos")
        .createSignedUrl(photo.storage_path, 60 * 5);
      if (!signed?.signedUrl) continue;
      const entry = tripPhotosByBooking.get(photo.booking_id) ?? { pickup: [], return: [] };
      entry[photo.stage].push({
        id: photo.id,
        url: signed.signedUrl,
        storagePath: photo.storage_path,
        uploaderId: photo.uploader_id,
      });
      tripPhotosByBooking.set(photo.booking_id, entry);
    }
  }

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
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{booking.cars?.city}</p>
                <p>
                  Termin: {booking.start_date} – {booking.end_date}
                </p>
                {booking.status === "accepted" && booking.payment_status === "unpaid" && (
                  <PayBookingButton bookingId={booking.id} />
                )}
                {booking.payment_status === "paid" && (
                  <p className="text-xs">
                    Opłacono{booking.total_price ? `: ${Number(booking.total_price).toFixed(2)} zł` : ""}
                    {booking.deposit_status === "held" &&
                      booking.deposit_amount &&
                      ` · kaucja ${Number(booking.deposit_amount).toFixed(2)} zł zablokowana`}
                  </p>
                )}
                {(booking.status === "requested" || booking.status === "accepted") &&
                  (() => {
                    const policy: CancellationPolicy =
                      booking.cars?.cancellation_policy ?? "moderate";
                    const deadline = freeCancellationDeadline(policy, booking.start_date);
                    const withinFreeWindow = isWithinFreeCancellationWindow(
                      policy,
                      booking.start_date
                    );
                    return (
                      <div className="space-y-2">
                        <p className="text-xs">
                          Polityka anulowania: {CANCELLATION_POLICY_LABELS[policy]} —{" "}
                          {withinFreeWindow
                            ? `darmowe anulowanie do ${deadline.toLocaleDateString("pl-PL")}`
                            : "termin darmowego anulowania minął"}
                        </p>
                        <form action={cancelBooking.bind(null, booking.id)}>
                          <Button type="submit" variant="outline" size="sm">
                            Anuluj rezerwację
                          </Button>
                        </form>
                      </div>
                    );
                  })()}
                {(booking.status === "accepted" || booking.status === "completed") && (
                  <TripPhotosManager
                    bookingId={booking.id}
                    currentUserId={user!.id}
                    pickupPhotos={tripPhotosByBooking.get(booking.id)?.pickup ?? []}
                    returnPhotos={tripPhotosByBooking.get(booking.id)?.return ?? []}
                    pickupOdometerKm={booking.pickup_odometer_km}
                    pickupFuelLevel={booking.pickup_fuel_level}
                    returnOdometerKm={booking.return_odometer_km}
                    returnFuelLevel={booking.return_fuel_level}
                  />
                )}
                {booking.status === "completed" && !reviewedBookingIds.has(booking.id) && (
                  <ReviewForm bookingId={booking.id} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
