import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EditCarForm } from "./edit-car-form";
import { PhotoManager } from "./photo-manager";
import { DeleteCarButton } from "./delete-car-button";

export default async function EditCarPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: car }, { data: profile }] = await Promise.all([
    supabase
      .from("cars")
      .select("*, car_images(id, storage_path, position)")
      .eq("id", params.id)
      .single(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);

  if (!car) {
    notFound();
  }
  const isAdmin = profile?.role === "admin";
  const isOwner = car.owner_id === user.id;
  if (!isOwner && !isAdmin) {
    redirect("/dashboard");
  }
  const viewingAsAdmin = isAdmin && !isOwner;

  const images = (car.car_images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((img) => ({
      id: img.id,
      storagePath: img.storage_path,
      url: supabase.storage.from("car-images").getPublicUrl(img.storage_path).data.publicUrl,
    }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={viewingAsAdmin ? "/admin" : "/dashboard"}
            className="text-sm text-muted-foreground hover:underline"
          >
            {viewingAsAdmin ? "← Panel admina" : "← Moje auta"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            Edytuj auto — {car.brand} {car.model}
          </h1>
        </div>
        <DeleteCarButton carId={car.id} redirectTo={viewingAsAdmin ? "/admin" : undefined} />
      </div>

      {car.status === "approved" && !isAdmin && (
        <p className="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
          To auto jest już zatwierdzone. Jeśli zmienisz zdjęcia lub dane, ogłoszenie
          wróci do statusu „Oczekuje na zatwierdzenie&rdquo; do czasu ponownej weryfikacji.
        </p>
      )}

      <div className="space-y-3">
        <h2 className="font-semibold">Zdjęcia</h2>
        <PhotoManager carId={car.id} images={images} />
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">Dane auta</h2>
        <EditCarForm car={car} />
      </div>

      <div className="border-t pt-4">
        <Link
          href={`/dashboard/cars/${car.id}/availability`}
          className="text-sm text-primary hover:underline"
        >
          Zarządzaj dostępnością →
        </Link>
      </div>
    </div>
  );
}
