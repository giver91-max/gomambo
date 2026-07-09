import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { FavoriteButton } from "@/components/favorite-button";

export default async function FavoritesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: favorites } = await supabase
    .from("favorites")
    .select("car_id, cars(*, car_images(storage_path, position))")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  const cars = (favorites ?? [])
    .map((f) => f.cars)
    .filter((car): car is NonNullable<typeof car> => car !== null);

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Ulubione samochody</h1>

      {cars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych ulubionych aut.{" "}
            <Link href="/auta" className="underline">
              Przeglądaj oferty
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cars.map((car) => {
            const images = (car.car_images ?? []) as {
              storage_path: string;
              position: number;
            }[];
            const sorted = images.slice().sort((a, b) => a.position - b.position);
            const thumbnail = sorted[0]
              ? supabase.storage.from("car-images").getPublicUrl(sorted[0].storage_path).data
                  .publicUrl
              : null;

            return (
              <Link key={car.id} href={`/auta/${car.id}`}>
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                  <div className="relative aspect-video w-full bg-muted">
                    <FavoriteButton carId={car.id} initialFavorited isLoggedIn />
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
