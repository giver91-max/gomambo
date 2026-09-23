import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { BookingActions } from "./booking-actions";
import { ReviewForm } from "./review-form";
import { TripPhotosManager, type TripPhotoItem } from "@/components/trip-photos-manager";
import { CaptureDepositButton } from "@/components/capture-deposit-button";
import { RequestExtraChargeButton } from "@/components/request-extra-charge-button";
import { ReportDamageButton } from "@/components/report-damage-button";
import { DamageReportList, type DamageReportItem } from "@/components/damage-report-list";
import { BookingVerificationOwner } from "@/components/booking-verification-owner";
import type { BookingVerificationStatus } from "@/lib/booking-verification";
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
       payment_status, deposit_status, total_price, platform_fee_amount, deposit_amount,
       cars(id, brand, model), renter_id,
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
    platform_fee_amount: number | null;
    deposit_amount: number | null;
    cars: { id: string; brand: string; model: string } | null;
    renter_id: string;
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
  const verificationByBooking = new Map<
    string,
    {
      status: BookingVerificationStatus;
      face_match_result: "match" | "no_match" | "error" | "not_run" | null;
      face_match_score: number | null;
      selfieUrl: string | null;
      licenceFrontUrl: string | null;
      licenceBackUrl: string | null;
    }
  >();
  if (activeBookingIds.length > 0) {
    const { data: verifications } = await supabase
      .from("booking_verifications")
      .select("booking_id, status, face_match_result, face_match_score, selfie_path")
      .in("booking_id", activeBookingIds);

    // The licence photos belong to the RENTER, and RLS on
    // identity_verifications admits only that user or an admin — so the
    // service role is the only way the person handing over the car can see
    // them. Two things keep that narrow: this page already filters to
    // bookings where the caller is the owner, and the links are minted ONLY
    // while the verification is still waiting on them. Once it is approved,
    // nothing here generates a URL any more.
    const adminClient = createAdminClient();
    const renterIdByBooking = new Map(bookings.map((b) => [b.id, b.renter_id]));
    const pendingRenterIds = (verifications ?? [])
      .filter((v) => v.status === "pending_owner")
      .map((v) => renterIdByBooking.get(v.booking_id))
      .filter((id): id is string => !!id);

    const licenceByRenter = new Map<string, { front: string | null; back: string | null }>();
    if (pendingRenterIds.length > 0) {
      const { data: identities } = await adminClient
        .from("identity_verifications")
        .select("user_id, document_path, document_back_path")
        .in("user_id", pendingRenterIds)
        .eq("status", "approved");
      for (const identity of identities ?? []) {
        const sign = async (path: string | null) => {
          if (!path) return null;
          const { data } = await adminClient.storage
            .from("id-documents")
            .createSignedUrl(path, 60 * 10);
          return data?.signedUrl ?? null;
        };
        licenceByRenter.set(identity.user_id, {
          front: await sign(identity.document_path),
          back: await sign(identity.document_back_path),
        });
      }
    }

    for (const row of verifications ?? []) {
      // Signed and short-lived: these live in a private bucket and must never
      // become durable links.
      let selfieUrl: string | null = null;
      let licenceFrontUrl: string | null = null;
      let licenceBackUrl: string | null = null;
      if (row.status === "pending_owner") {
        if (row.selfie_path) {
          const { data: signed } = await adminClient.storage
            .from("id-documents")
            .createSignedUrl(row.selfie_path, 60 * 10);
          selfieUrl = signed?.signedUrl ?? null;
        }
        const renterId = renterIdByBooking.get(row.booking_id);
        const licence = renterId ? licenceByRenter.get(renterId) : undefined;
        licenceFrontUrl = licence?.front ?? null;
        licenceBackUrl = licence?.back ?? null;
      }
      verificationByBooking.set(row.booking_id, {
        status: row.status,
        face_match_result: row.face_match_result,
        face_match_score: row.face_match_score,
        selfieUrl,
        licenceFrontUrl,
        licenceBackUrl,
      });
    }
  }

  const damageReportsByBooking = new Map<string, DamageReportItem[]>();
  if (activeBookingIds.length > 0) {
    // RLS on damage_reports admits both participants, so the session client
    // is enough — and is what keeps one booking's reports off another's card.
    const { data: reports } = await supabase
      .from("damage_reports")
      .select("id, booking_id, description, reporter_role, reporter_id, status, created_at")
      .in("booking_id", activeBookingIds)
      .order("created_at", { ascending: false });
    for (const report of reports ?? []) {
      const list = damageReportsByBooking.get(report.booking_id) ?? [];
      list.push({
        id: report.id,
        description: report.description,
        reporter_role: report.reporter_role,
        status: report.status,
        created_at: report.created_at,
        mine: report.reporter_id === user!.id,
      });
      damageReportsByBooking.set(report.booking_id, list);
    }
  }

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
                    {/* The renter pays the listing price plus the platform fee,
                        so the gross would overstate what the owner receives. */}
                    {booking.total_price
                      ? `Do wypłaty: ${(Number(booking.total_price) - Number(booking.platform_fee_amount ?? 0)).toFixed(2)} zł`
                      : "Opłacono"}
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
                    <ReportDamageButton bookingId={booking.id} />
                  </div>
                )}
                {booking.status === "accepted" && verificationByBooking.has(booking.id) && (
                  <BookingVerificationOwner
                    bookingId={booking.id}
                    status={verificationByBooking.get(booking.id)!.status}
                    renterName={booking.renter?.full_name || "Najemca"}
                    selfieUrl={verificationByBooking.get(booking.id)!.selfieUrl}
                    licenceFrontUrl={verificationByBooking.get(booking.id)!.licenceFrontUrl}
                    licenceBackUrl={verificationByBooking.get(booking.id)!.licenceBackUrl}
                    faceMatchResult={verificationByBooking.get(booking.id)!.face_match_result}
                    faceMatchScore={verificationByBooking.get(booking.id)!.face_match_score}
                  />
                )}
                {(booking.status === "accepted" || booking.status === "completed") && (
                  <DamageReportList reports={damageReportsByBooking.get(booking.id) ?? []} />
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
