import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CarReviewCard } from "./car-review-card";
import type { CarStatus, IdentityVerificationStatus, PartnerStatus } from "@/types/database";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/back-button";
import { PARTNER_STATUS_LABELS } from "@/lib/partner";
import { adminFileUrl } from "../plik/url";
import { missingForApproval, OWNER_VERIFICATION_LABELS } from "./approval-gate";

const TABS: { value: CarStatus; label: string }[] = [
  { value: "pending", label: "Oczekujące" },
  { value: "approved", label: "Zatwierdzone" },
  { value: "rejected", label: "Odrzucone" },
  { value: "paused", label: "Wstrzymane" },
];

export default async function AdminCarsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status: CarStatus =
    searchParams.status === "approved" ||
    searchParams.status === "rejected" ||
    searchParams.status === "paused"
      ? searchParams.status
      : "pending";

  const supabase = await createClient();

  const { data: cars } = await supabase
    .from("cars")
    .select(
      "*, car_images(storage_path), owner:profiles(full_name), car_private(registration_number, insurance_document_path, insurance_valid_until, inspection_valid_until, rental_right_confirmed_at), partners(trade_name, status)"
    )
    .eq("status", status)
    .order("created_at", { ascending: true });

  // Whether each private owner has verified their identity — approval needs
  // it (approval-gate.ts), and the card used not to show it at all.
  const ownerIds = Array.from(new Set((cars ?? []).map((c) => c.owner_id)));
  const { data: ownerVerifications } = ownerIds.length
    ? await supabase.from("identity_verifications").select("user_id, status").in("user_id", ownerIds)
    : { data: [] as { user_id: string; status: IdentityVerificationStatus }[] };
  const verificationByOwner = new Map(
    (ownerVerifications ?? []).map((v) => [v.user_id, v.status as IdentityVerificationStatus])
  );

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Samochody</h1>

      {/* Wraps like the other admin tabs: four labels in one row made the
          page wider than a phone, so the browser zoomed the whole page out. */}
      <div className="flex flex-wrap gap-2 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/cars?status=${tab.value}`}
            className={cn(
              "px-3 py-2 text-sm",
              status === tab.value
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {!cars || cars.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          Brak aut w tej kategorii.
        </p>
      ) : (
        <div className="space-y-4">
          {await Promise.all(
            cars.map(async (car) => {
              const imageUrls = (car.car_images ?? []).map(
                (img: { storage_path: string }) =>
                  supabase.storage.from("car-images").getPublicUrl(img.storage_path)
                    .data.publicUrl
              );
              const owner = car.owner as { full_name: string } | null;

              // Plate and insurance moved to car_private (0037); an admin
              // reads them through that table's own RLS policy.
              const carPrivate = (car.car_private ?? null) as unknown as {
                registration_number: string | null;
                insurance_document_path: string | null;
                insurance_valid_until: string | null;
                inspection_valid_until: string | null;
                rental_right_confirmed_at: string | null;
              } | null;

              // A stable link signed when it is opened (../plik/route.ts): a
              // five-minute signed URL in the HTML had expired by the time the
              // admin reached the third car and clicked the PDF.
              const insuranceUrl = carPrivate?.insurance_document_path
                ? adminFileUrl("polisa", car.id, carPrivate.insurance_document_path)
                : null;
              const insuranceIsPdf =
                carPrivate?.insurance_document_path?.toLowerCase().endsWith(".pdf") ?? false;

              // Which company this car belongs to, and whether that company
              // is live. The DB invariant forces a car of an inactive company
              // back to 'paused', so approval waits for the company
              // (approval-gate.ts) and the reviewer sees why.
              const carPartner = (car.partners ?? null) as unknown as {
                trade_name: string;
                status: PartnerStatus;
              } | null;
              const partnerStatusLabel = carPartner
                ? PARTNER_STATUS_LABELS[carPartner.status] ?? carPartner.status
                : null;
              const ownerVerification = verificationByOwner.get(car.owner_id) ?? null;

              const missing = missingForApproval({
                registrationNumber: carPrivate?.registration_number ?? null,
                insuranceDocumentPath: carPrivate?.insurance_document_path ?? null,
                insuranceValidUntil: carPrivate?.insurance_valid_until ?? null,
                inspectionValidUntil: carPrivate?.inspection_valid_until ?? null,
                rentalRightConfirmedAt: carPrivate?.rental_right_confirmed_at ?? null,
                partner:
                  car.partner_id && carPartner
                    ? { status: carPartner.status, statusLabel: partnerStatusLabel ?? "" }
                    : null,
                ownerVerification: car.partner_id ? null : ownerVerification,
              });

              return (
                <CarReviewCard
                  key={car.id}
                  partnerName={carPartner?.trade_name ?? null}
                  partnerStatus={carPartner?.status ?? null}
                  partnerStatusLabel={partnerStatusLabel}
                  ownerVerificationLabel={
                    car.partner_id
                      ? null
                      : OWNER_VERIFICATION_LABELS[ownerVerification ?? "none"]
                  }
                  ownerVerified={ownerVerification === "approved"}
                  missing={missing}
                  car={{
                    ...car,
                    registration_number: carPrivate?.registration_number ?? null,
                    insurance_valid_until: carPrivate?.insurance_valid_until ?? null,
                    inspection_valid_until: carPrivate?.inspection_valid_until ?? null,
                    rental_right_confirmed_at: carPrivate?.rental_right_confirmed_at ?? null,
                  }}
                  ownerName={owner?.full_name ?? ""}
                  imageUrls={imageUrls}
                  insuranceUrl={insuranceUrl}
                  insuranceIsPdf={insuranceIsPdf}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
