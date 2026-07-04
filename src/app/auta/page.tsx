import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default async function AutaPage({
  searchParams,
}: {
  searchParams: { city?: string; maxPrice?: string };
}) {
  const supabase = await createClient();

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

  const { data: cars } = await query;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Przeglądaj auta</h1>
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
                  <div className="aspect-video w-full bg-muted">
                    {thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnail}
                        alt={`${car.brand} ${car.model}`}
                        className="h-full w-full object-cover"
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
