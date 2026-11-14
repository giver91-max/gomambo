import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { cancelBooking } from "../bookings/actions";
import { ReviewForm } from "../bookings/review-form";
import { ReportDamageButton } from "@/components/report-damage-button";
import { DamageReportList, type DamageReportItem } from "@/components/damage-report-list";
import { BookingVerificationRenter } from "@/components/booking-verification-renter";
import type { BookingVerificationStatus } from "@/lib/booking-verification";
import { TripPhotosManager, type TripPhotoItem } from "@/components/trip-photos-manager";
import { PayBookingButton } from "@/components/pay-booking-button";
import { RentalLiabilityNotice } from "@/components/rental-liability-notice";
import { firstNameOnly } from "@/lib/utils";
import { PayExtraChargeButton } from "@/components/pay-extra-charge-button";
import { ExtendBookingForm } from "@/components/extend-booking-form";
import type { BookingStatus, CancellationPolicy } from "@/types/database";
import { CANCELLATION_POLICY_LABELS } from "@/lib/car-options";
import { freeCancellationDeadline, isWithinFreeCancellationWindow } from "@/lib/cancellation";
import {
  DEPOSIT_PANEL_COLUMNS,
  DepositRenterPanel,
  type DepositPanelRow,
} from "@/components/deposit-renter-panel";
import { bookingDepositAmounts } from "@/lib/deposit";
import { todayInPoland } from "@/lib/calendar";

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
       payment_status, payment_method, total_price, deposit_amount, deposit_fee_amount,
       cars(id, brand, model, city, cancellation_policy, security_deposit_amount,
            mileage_limit_km, mileage_overage_fee_per_km,
            partners(trade_name), owner:profiles!cars_owner_id_fkey(full_name))`
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

  const extraChargesByBooking = new Map<
    string,
    { id: string; amount_pln: number; reason: string; payment_method: "stripe" | "bank_transfer" }[]
  >();
  if (activeBookingIds.length > 0) {
    const { data: extraCharges } = await supabase
      .from("booking_extra_charges")
      .select("id, booking_id, amount_pln, reason, payment_method")
      .in("booking_id", activeBookingIds)
      .eq("status", "requested");
    for (const charge of extraCharges ?? []) {
      const list = extraChargesByBooking.get(charge.booking_id) ?? [];
      list.push({
        id: charge.id,
        amount_pln: Number(charge.amount_pln),
        reason: charge.reason,
        payment_method: charge.payment_method,
      });
      extraChargesByBooking.set(charge.booking_id, list);
    }
  }
  const verificationByBooking = new Map<
    string,
    { status: BookingVerificationStatus; face_match_result: "match" | "no_match" | "error" | "not_run" | null }
  >();
  if (activeBookingIds.length > 0) {
    const { data: verifications } = await supabase
      .from("booking_verifications")
      .select("booking_id, status, face_match_result")
      .in("booking_id", activeBookingIds);
    for (const row of verifications ?? []) {
      verificationByBooking.set(row.booking_id, {
        status: row.status,
        face_match_result: row.face_match_result,
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

  // RLS on booking_deposits admits both participants, like damage_reports.
  // Cancelled bookings included: that is where a returned deposit shows.
  const depositByBooking = new Map<string, DepositPanelRow>();
  const allBookingIds = (bookings ?? []).map((b) => b.id);
  if (allBookingIds.length > 0) {
    const { data: deposits } = await supabase
      .from("booking_deposits")
      .select(DEPOSIT_PANEL_COLUMNS)
      .in("booking_id", allBookingIds);
    for (const row of (deposits ?? []) as unknown as (DepositPanelRow & { booking_id: string })[]) {
      depositByBooking.set(row.booking_id, row);
    }
  }
  const today = todayInPoland();

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
          {bookings.map((booking) => {
            // The amounts pinned on the booking; a booking from before they
            // were pinned falls back to the car's current deposit. Fails
            // CLOSED when the car row isn't readable (an owner editing the
            // listing sends it back to 'pending' and RLS hides it): the
            // pinned amount is still on the booking itself.
            const depositTerms = bookingDepositAmounts(
              booking.deposit_amount,
              booking.deposit_fee_amount,
              booking.cars?.security_deposit_amount ?? null
            );
            const deposit = depositByBooking.get(booking.id) ?? null;
            return (
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
                  <div className="space-y-3">
                    {/* Second time they see this, right before the money moves. */}
                    <RentalLiabilityNotice
                      compact
                      party={{
                        partnerName:
                          (booking.cars?.partners as unknown as { trade_name: string } | null)
                            ?.trade_name ?? null,
                        ownerName: firstNameOnly(
                          (booking.cars?.owner as unknown as { full_name: string } | null)
                            ?.full_name || "Właściciel"
                        ),
                      }}
                      rules={{
                        depositAmount: depositTerms.amount,
                        depositFee: depositTerms.fee,
                        mileageLimitKm: booking.cars?.mileage_limit_km ?? null,
                        mileageOverageFeePerKm:
                          booking.cars?.mileage_overage_fee_per_km != null
                            ? Number(booking.cars.mileage_overage_fee_per_km)
                            : null,
                      }}
                    />
                    {booking.payment_method === "bank_transfer" && (
                      <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3">
                        <p className="font-medium text-foreground">Czekamy na Twój przelew</p>
                        <p>
                          Kwota:{" "}
                          <strong className="text-foreground">
                            {booking.total_price ? Number(booking.total_price).toFixed(2) : "—"} zł
                          </strong>{" "}
                          · tytuł przelewu:{" "}
                          <code className="font-mono text-foreground">{booking.id.slice(0, 8)}</code>
                        </p>
                        <p className="text-xs">
                          Rezerwacja zostanie potwierdzona, gdy zaksięgujemy wpłatę. Dane do
                          przelewu wysyłamy wiadomością. Możesz też zapłacić od razu kartą poniżej.
                        </p>
                      </div>
                    )}
                    <PayBookingButton
                      bookingId={booking.id}
                      depositAmount={depositTerms.amount}
                      depositFee={depositTerms.fee}
                    />
                  </div>
                )}
                {booking.payment_status === "paid" && (
                  <p className="text-xs">
                    Opłacono{booking.total_price ? `: ${Number(booking.total_price).toFixed(2)} zł` : ""}
                  </p>
                )}
                {(booking.status === "accepted" ||
                  booking.status === "completed" ||
                  (booking.status === "cancelled" && deposit !== null)) && (
                  <DepositRenterPanel
                    bookingId={booking.id}
                    bookingStatus={booking.status}
                    startDate={booking.start_date}
                    endDate={booking.end_date}
                    deposit={deposit}
                    scheduled={depositTerms}
                  />
                )}
                {/* A wire has no card charge to reverse, so payment_status
                    stays 'paid' until someone sends the money back by hand —
                    without this the card would read "Anulowana / Opłacono"
                    and say nothing about the refund. */}
                {booking.status === "cancelled" &&
                  booking.payment_status === "paid" &&
                  booking.payment_method === "bank_transfer" && (
                    <p className="text-xs text-foreground">
                      Zwrot wpłaty wykonamy przelewem na konto, z którego przyszła — odezwiemy się
                      do Ciebie.
                    </p>
                  )}
                {(extraChargesByBooking.get(booking.id) ?? []).map((charge) => (
                  <PayExtraChargeButton
                    key={charge.id}
                    extraChargeId={charge.id}
                    amountPln={charge.amount_pln}
                    reason={charge.reason}
                    paymentMethod={charge.payment_method}
                  />
                ))}
                {/* Up to the last day of the trip, and not once the deposit
                    is being settled — the server refuses both as well. */}
                {booking.status === "accepted" &&
                  booking.payment_status === "paid" &&
                  booking.end_date >= today &&
                  (!deposit || ["requested", "processing", "paid"].includes(deposit.status)) && (
                    <ExtendBookingForm bookingId={booking.id} currentEndDate={booking.end_date} />
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
                        {/* PAY-1: from the start date on only GoMambo cancels. */}
                        {booking.start_date > today ? (
                          <form action={cancelBooking.bind(null, booking.id)}>
                            <Button type="submit" variant="outline" size="sm">
                              Anuluj rezerwację
                            </Button>
                          </form>
                        ) : (
                          <p className="text-xs">
                            Od dnia rozpoczęcia wynajmu rezerwację może anulować tylko GoMambo —
                            napisz do nas przez czat.
                          </p>
                        )}
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
                {booking.status === "accepted" && verificationByBooking.has(booking.id) && (
                  <BookingVerificationRenter
                    bookingId={booking.id}
                    status={verificationByBooking.get(booking.id)!.status}
                    depositPending={depositTerms.amount > 0 && deposit?.status !== "paid"}
                  />
                )}
                {(booking.status === "accepted" || booking.status === "completed") && (
                  <>
                    <DamageReportList reports={damageReportsByBooking.get(booking.id) ?? []} />
                    <ReportDamageButton bookingId={booking.id} />
                  </>
                )}
                {booking.status === "completed" && !reviewedBookingIds.has(booking.id) && (
                  <ReviewForm bookingId={booking.id} />
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
