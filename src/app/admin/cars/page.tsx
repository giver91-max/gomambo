import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CarReviewCard } from "./car-review-card";
import type { CarStatus } from "@/types/database";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/back-button";

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
      "*, car_images(storage_path), owner:profiles(full_name), car_private(registration_number, insurance_document_path), partners(trade_name, status)"
    )
    .eq("status", status)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Samochody</h1>

      <div className="flex gap-2 border-b">
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
              } | null;

              let insuranceUrl: string | null = null;
              if (carPrivate?.insurance_document_path) {
                const { data: signed } = await supabase.storage
                  .from("car-insurance")
                  .createSignedUrl(carPrivate.insurance_document_path, 60 * 5);
                insuranceUrl = signed?.signedUrl ?? null;
              }
              const insuranceIsPdf =
                carPrivate?.insurance_document_path?.toLowerCase().endsWith(".pdf") ?? false;

              // Which company this car belongs to, and whether that company
              // is live. Approving a car for a suspended partner silently
              // does nothing (the DB invariant forces it back to 'paused'),
              // so the reviewer has to be able to see it coming.
              const carPartner = (car.partners ?? null) as unknown as {
                trade_name: string;
                status: string;
              } | null;

              return (
                <CarReviewCard
                  key={car.id}
                  partnerName={carPartner?.trade_name ?? null}
                  partnerStatus={carPartner?.status ?? null}
                  car={{
                    ...car,
                    registration_number: carPrivate?.registration_number ?? null,
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
