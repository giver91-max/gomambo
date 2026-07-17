import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvailabilityAndInquiry } from "./availability-and-inquiry";
import { toISODate } from "@/lib/calendar";
import { BackButton } from "@/components/back-button";
import { FavoriteButton } from "@/components/favorite-button";
import { MaintenanceNotice } from "@/components/maintenance-notice";
import { firstNameOnly } from "@/lib/utils";
import {
  CANCELLATION_POLICY_DESCRIPTIONS,
  CANCELLATION_POLICY_LABELS,
  FUEL_POLICY_DESCRIPTIONS,
  FUEL_POLICY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_TYPE_LABELS,
} from "@/lib/car-options";

const getCar = cache(async (id: string) => {
  const supabase = await createClient();
  const { data: car } = await supabase
    .from("cars")
    .select("*, car_images(storage_path, position)")
    .eq("id", id)
    .eq("status", "approved")
    .order("position", { referencedTable: "car_images", ascending: true })
    .single();

  const images = (car?.car_images ?? []) as {
    storage_path: string;
    position: number;
  }[];
  const imageUrls = images.map(
    (img) =>
      supabase.storage.from("car-images").getPublicUrl(img.storage_path).data
        .publicUrl
  );

  let availableDates: string[] = [];
  if (car) {
    const { data: availability } = await supabase
      .from("car_availability")
      .select("date")
      .eq("car_id", car.id)
      .gte("date", toISODate(new Date()))
      .order("date");
    availableDates = (availability ?? []).map((row) => row.date);
  }

  return { car, imageUrls, availableDates };
});

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const { car, imageUrls } = await getCar(params.id);

  if (!car) {
    return { title: "Auto nie znalezione" };
  }

  const title = `${car.brand} ${car.model} (${car.year}) — ${car.city}`;
  const description =
    car.description ??
    `Wynajmij ${car.brand} ${car.model} z ${car.year} roku w ${car.city} za ${Number(car.price_per_day).toFixed(0)} zł/dzień na GoMambo.`;

  return {
    title,
    description,
    alternates: { canonical: `/auta/${car.id}` },
    openGraph: {
      title,
      description,
      images: imageUrls.length > 0 ? [imageUrls[0]] : undefined,
    },
  };
}

export default async function CarDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { car, imageUrls, availableDates } = await getCar(params.id);

  if (!car) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    isAdmin = profile?.role === "admin";
  }

  if (!isAdmin) {
    const { data: siteSettings } = await supabase
      .from("site_settings")
      .select("maintenance_mode")
      .eq("id", 1)
      .single();
    if (siteSettings?.maintenance_mode) {
      return (
        <div className="space-y-6">
          <BackButton />
          <MaintenanceNotice />
        </div>
      );
    }
  }

  let isFavorited = false;
  if (user) {
    const { data: favorite } = await supabase
      .from("favorites")
      .select("id")
      .eq("user_id", user.id)
      .eq("car_id", car.id)
      .maybeSingle();
    isFavorited = !!favorite;
  }

  // Reviews left ABOUT the owner (as a host) — not reviews the owner left
  // about their renters, which also carry this car's car_id.
  const { data: rawReviews } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(full_name)")
    .eq("reviewee_id", car.owner_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const reviews = (rawReviews ?? []) as unknown as {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    reviewer: { full_name: string } | null;
  }[];
  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null;

  const [{ data: ownerProfile }, { data: ownerVerification }] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_path").eq("id", car.owner_id).single(),
    supabase
      .from("identity_verifications")
      .select("status")
      .eq("user_id", car.owner_id)
      .eq("status", "approved")
      .maybeSingle(),
  ]);
  const isOwnerVerified = !!ownerVerification;
  const ownerAvatarUrl = ownerProfile?.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(ownerProfile.avatar_path).data.publicUrl
    : null;
  const ownerName = firstNameOnly(ownerProfile?.full_name || "Właściciel");

  return (
    <div className="space-y-6">
      <BackButton />

      <div className="relative">
        <FavoriteButton carId={car.id} initialFavorited={isFavorited} isLoggedIn={!!user} />
        {imageUrls.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {imageUrls.map((src, i) => (
              <div key={i} className="relative aspect-square w-full overflow-hidden rounded-lg">
                <Image
                  src={src}
                  alt={`${car.brand} ${car.model} - zdjęcie ${i + 1}`}
                  fill
                  sizes="(min-width: 640px) 33vw, 50vw"
                  className="object-cover"
                  priority={i === 0}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="aspect-video w-full rounded-lg bg-muted" />
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {car.brand} {car.model} ({car.year})
        </h1>
        <p className="text-muted-foreground">{car.city}</p>
      </div>

      {(car.vehicle_type || car.fuel_type || car.transmission || car.seats) && (
        <div className="flex flex-wrap gap-2">
          {car.vehicle_type && (
            <Badge variant="secondary">{VEHICLE_TYPE_LABELS[car.vehicle_type]}</Badge>
          )}
          {car.fuel_type && <Badge variant="secondary">{FUEL_TYPE_LABELS[car.fuel_type]}</Badge>}
          {car.transmission && (
            <Badge variant="secondary">{TRANSMISSION_LABELS[car.transmission]}</Badge>
          )}
          {car.seats && <Badge variant="secondary">{car.seats} miejsc</Badge>}
          <Badge variant="secondary">
            {car.mileage_limit_km ? `${car.mileage_limit_km} km / dzień` : "Bez limitu km"}
          </Badge>
        </div>
      )}

      {car.mileage_limit_km && car.mileage_overage_fee_per_km && (
        <p className="text-xs text-muted-foreground">
          Po przekroczeniu limitu: {Number(car.mileage_overage_fee_per_km).toFixed(2)} zł / km.
        </p>
      )}

      {car.description && (
        <div>
          <h2 className="mb-2 font-semibold">Opis</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {car.description}
          </p>
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Dostępność i zapytanie</h2>
            <div className="text-right text-sm text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">
                  {Number(car.price_per_day).toFixed(2)} zł
                </span>{" "}
                / dzień
              </p>
              {car.price_per_month && (
                <p>
                  <span className="font-semibold text-foreground">
                    {Number(car.price_per_month).toFixed(2)} zł
                  </span>{" "}
                  / miesiąc (28+ dni)
                </p>
              )}
            </div>
          </div>
          {car.delivery_available && (
            <p className="text-sm text-muted-foreground">
              🚗 Właściciel oferuje dowóz auta.
              {car.delivery_info ? ` ${car.delivery_info}` : ""}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Anulowanie: {CANCELLATION_POLICY_LABELS[car.cancellation_policy]} —{" "}
            {CANCELLATION_POLICY_DESCRIPTIONS[car.cancellation_policy]}
          </p>
          {car.fuel_policy && (
            <p className="text-sm text-muted-foreground">
              Paliwo: {FUEL_POLICY_LABELS[car.fuel_policy]} —{" "}
              {FUEL_POLICY_DESCRIPTIONS[car.fuel_policy]}
            </p>
          )}
          {car.security_deposit_amount && (
            <p className="text-sm text-muted-foreground">
              Kaucja: {Number(car.security_deposit_amount).toFixed(2)} zł — blokowana na
              karcie przy płatności, zwalniana po zakończeniu wynajmu.
            </p>
          )}
          <AvailabilityAndInquiry
            carId={car.id}
            availableDates={availableDates}
            isLoggedIn={!!user}
            pricePerDay={Number(car.price_per_day)}
            pricePerMonth={car.price_per_month ? Number(car.price_per_month) : null}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="font-semibold">O właścicielu</h2>
        <div className="flex items-center gap-3">
          <Avatar size="lg" className="size-14">
            <AvatarImage src={ownerAvatarUrl ?? undefined} alt={ownerName} />
            <AvatarFallback className="text-base">
              {ownerName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{ownerName}</p>
              {isOwnerVerified && <Badge>Zweryfikowany właściciel</Badge>}
            </div>
            {avgRating !== null ? (
              <p className="text-sm text-muted-foreground">
                <span className="text-primary">★</span> {avgRating.toFixed(1)} ({reviews.length}{" "}
                {reviews.length === 1 ? "opinia" : "opinii"})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Brak opinii jeszcze.</p>
            )}
          </div>
        </div>

        {reviews.map((review) => (
          <div key={review.id} className="rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">{review.reviewer?.full_name || "Użytkownik"}</p>
              <p className="text-primary">
                {"★".repeat(review.rating)}
                <span className="text-muted-foreground/40">
                  {"★".repeat(5 - review.rating)}
                </span>
              </p>
            </div>
            {review.comment && (
              <p className="mt-1 text-muted-foreground">{review.comment}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(review.created_at).toLocaleDateString("pl-PL")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
