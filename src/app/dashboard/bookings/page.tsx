import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { BookingActions } from "./booking-actions";
import { ReviewForm } from "./review-form";
import { TripPhotosManager, type TripPhotoItem } from "@/components/trip-photos-manager";
import { CaptureDepositButton } from "@/components/capture-deposit-button";
import { RequestExtraChargeButton } from "@/components/request-extra-charge-button";
import type { BookingStatus, DepositStatus, FuelLevel, PaymentStatus } from "@/types/database";

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
       pickup_odometer_km, pickup_fuel_level, return_odometer_km, return_fuel_level,
       payment_status, deposit_status, total_price, deposit_amount,
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
    pickup_odometer_km: number | null;
    pickup_fuel_level: FuelLevel | null;
    return_odometer_km: number | null;
    return_fuel_level: FuelLevel | null;
    payment_status: PaymentStatus;
    deposit_status: DepositStatus;
    total_price: number | null;
    deposit_amount: number | null;
    cars: { id: string; brand: string; model: string } | null;
    renter: { full_name: string } | null;
  }[];

  const completedIds = bookings.filter((b) => b.status === "completed").map((b) => b.id);
  let reviewedBookingIds = new Set<string>();
  if (completedIds.length > 0) {
    const { data: reviews } = await supabase
      .from("reviews")
      .select("booking_id")
      .eq("reviewer_id", user!.id)
      .in("booking_id", completedIds);
    reviewedBookingIds = new Set((reviews ?? []).map((r) => r.booking_id));
  }

  const activeBookingIds = bookings
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
      <h1 className="text-2xl font-bold">Rezerwacje</h1>

      {bookings.length === 0 ? (
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
                {booking.payment_status === "paid" && (
                  <p className="text-xs">
                    Opłacono{booking.total_price ? `: ${Number(booking.total_price).toFixed(2)} zł` : ""}
                    {booking.deposit_status === "held" &&
                      booking.deposit_amount &&
                      ` · kaucja ${Number(booking.deposit_amount).toFixed(2)} zł zablokowana`}
                    {booking.deposit_status === "captured" && " · kaucja zatrzymana"}
                  </p>
                )}
                {(booking.status === "accepted" || booking.status === "completed") && (
                  <div className="flex flex-wrap gap-2">
                    {booking.status === "accepted" &&
                      booking.deposit_status === "held" &&
                      booking.deposit_amount && (
                        <CaptureDepositButton
                          bookingId={booking.id}
                          depositAmount={Number(booking.deposit_amount)}
                        />
                      )}
                    <RequestExtraChargeButton bookingId={booking.id} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  {(booking.status === "requested" || booking.status === "accepted") && (
                    <BookingActions bookingId={booking.id} status={booking.status} />
                  )}
                  <Link
                    href={`/dashboard/messages`}
                    className="text-sm text-primary hover:underline"
                  >
                    Wiadomości →
                  </Link>
                  {(booking.status === "completed" ||
                    booking.status === "declined" ||
                    booking.status === "cancelled") && <span>Czat zamknięty</span>}
                </div>
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
