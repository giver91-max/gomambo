import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { AvailabilityAndInquiry } from "./availability-and-inquiry";
import { toISODate } from "@/lib/calendar";

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

  return (
    <div className="space-y-6">
      {imageUrls.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {imageUrls.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`${car.brand} ${car.model} - zdjęcie ${i + 1}`}
              className="aspect-square w-full rounded-lg object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="aspect-video w-full rounded-lg bg-muted" />
      )}

      <div>
        <h1 className="text-2xl font-bold">
          {car.brand} {car.model} ({car.year})
        </h1>
        <p className="text-muted-foreground">{car.city}</p>
      </div>

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
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {Number(car.price_per_day).toFixed(2)} zł
              </span>{" "}
              / dzień
            </p>
          </div>
          <AvailabilityAndInquiry carId={car.id} availableDates={availableDates} />
        </CardContent>
      </Card>
    </div>
  );
}
