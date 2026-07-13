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
    .select("*, car_images(storage_path), owner:profiles(full_name)")
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
          {cars.map((car) => {
            const imageUrls = (car.car_images ?? []).map(
              (img: { storage_path: string }) =>
                supabase.storage.from("car-images").getPublicUrl(img.storage_path)
                  .data.publicUrl
            );
            const owner = car.owner as { full_name: string } | null;

            return (
              <CarReviewCard
                key={car.id}
                car={car}
                ownerName={owner?.full_name ?? ""}
                imageUrls={imageUrls}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
