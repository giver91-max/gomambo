import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { FavoriteButton } from "@/components/favorite-button";
import { MaintenanceNotice } from "@/components/maintenance-notice";
import { eachDateInRange, toISODate } from "@/lib/calendar";

export const metadata: Metadata = {
  title: "Wypożyczalnia aut — wynajmij auto od sąsiada",
  description:
    "GoMambo to internetowa wypożyczalnia samochodów peer-to-peer. Przeglądaj sprawdzone auta dostępne do wynajęcia od prywatnych właścicieli w Twojej okolicy. Filtruj po mieście i cenie.",
  alternates: { canonical: "/auta" },
};

export default async function AutaPage({
  searchParams,
}: {
  searchParams: { city?: string; maxPrice?: string; startDate?: string; endDate?: string };
}) {
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
        <div className="space-y-8">
          <BackButton />
          <MaintenanceNotice />
        </div>
      );
    }
  }

  const { data: allApproved } = await supabase
    .from("cars")
    .select("city")
    .eq("status", "approved");

  const cities = Array.from(
    new Set((allApproved ?? []).map((c) => c.city))
  ).sort();

  let query = supabase
    .from("cars")
    .select("*, car_images(storage_path, position)")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .order("position", { referencedTable: "car_images", ascending: true });

  if (searchParams.city) {
    query = query.eq("city", searchParams.city);
  }
  const maxPrice = Number(searchParams.maxPrice);
  if (searchParams.maxPrice && Number.isFinite(maxPrice) && maxPrice > 0) {
    query = query.lte("price_per_day", maxPrice);
  }

  const todayIso = toISODate(new Date());
  const { startDate, endDate } = searchParams;
  if (startDate && endDate && startDate >= todayIso && endDate >= startDate) {
    const wantedDates = eachDateInRange(startDate, endDate);
    const { data: availabilityRows } = await supabase
      .from("car_availability")
      .select("car_id, date")
      .gte("date", startDate)
      .lte("date", endDate);

    const datesByCarId = new Map<string, Set<string>>();
    for (const row of availabilityRows ?? []) {
      const set = datesByCarId.get(row.car_id) ?? new Set<string>();
      set.add(row.date);
      datesByCarId.set(row.car_id, set);
    }
    const availableCarIds = Array.from(datesByCarId.entries())
      .filter(([, dates]) => wantedDates.every((d) => dates.has(d)))
      .map(([carId]) => carId);

    // No car is available for the range — pass an id that can't match
    // instead of skipping the filter, so the listing correctly shows nothing.
    query = query.in(
      "id",
      availableCarIds.length > 0 ? availableCarIds : ["00000000-0000-0000-0000-000000000000"]
    );
  }

  const { data: cars } = await query;

  let favoriteCarIds = new Set<string>();
  if (user) {
    const { data: favorites } = await supabase
      .from("favorites")
      .select("car_id")
      .eq("user_id", user.id);
    favoriteCarIds = new Set((favorites ?? []).map((f) => f.car_id));
  }

  return (
    <div className="space-y-8">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Wypożyczalnia aut — przeglądaj oferty</h1>
        <p className="text-sm text-muted-foreground">
          Zatwierdzone samochody dostępne od właścicieli w Twojej okolicy.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <div className="space-y-2">
          <Label htmlFor="city">Miasto</Label>
          <select
            id="city"
            name="city"
            defaultValue={searchParams.city ?? ""}
            className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">Wszystkie miasta</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxPrice">Cena maks. (zł/dzień)</Label>
          <Input
            id="maxPrice"
            name="maxPrice"
            type="number"
            min={1}
            placeholder="np. 200"
            defaultValue={searchParams.maxPrice ?? ""}
            className="w-40"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startDate">Od</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            min={todayIso}
            defaultValue={searchParams.startDate ?? ""}
            className="w-40"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">Do</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            min={searchParams.startDate ?? todayIso}
            defaultValue={searchParams.endDate ?? ""}
            className="w-40"
          />
        </div>
        <Button type="submit">Filtruj</Button>
      </form>

      {!cars || cars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Brak aut spełniających kryteria.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cars.map((car) => {
            const images = (car.car_images ?? []) as {
              storage_path: string;
              position: number;
            }[];
            const thumbnail = images[0]
              ? supabase.storage
                  .from("car-images")
                  .getPublicUrl(images[0].storage_path).data.publicUrl
              : null;

            return (
              <Link key={car.id} href={`/auta/${car.id}`}>
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div className="relative aspect-video w-full bg-muted">
                    <FavoriteButton
                      carId={car.id}
                      initialFavorited={favoriteCarIds.has(car.id)}
                      isLoggedIn={!!user}
                    />
                    {thumbnail && (
                      <Image
                        src={thumbnail}
                        alt={`${car.brand} ${car.model}`}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {car.brand} {car.model} ({car.year})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <p>{car.city}</p>
                    <p className="font-semibold text-foreground">
                      {Number(car.price_per_day).toFixed(2)} zł / dzień
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
