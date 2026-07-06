import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AvailabilityEditor } from "./availability-editor";

export default async function CarAvailabilityPage({
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

  const { data: car } = await supabase
    .from("cars")
    .select("id, brand, model, owner_id")
    .eq("id", params.id)
    .single();

  if (!car) {
    notFound();
  }
  if (car.owner_id !== user.id) {
    redirect("/dashboard");
  }

  const { data: availability } = await supabase
    .from("car_availability")
    .select("date")
    .eq("car_id", car.id);

  const initialAvailable = (availability ?? []).map((row) => row.date);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Moje auta
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          Dostępność — {car.brand} {car.model}
        </h1>
        <p className="text-sm text-muted-foreground">
          Zaznacz dni, w które Twoje auto jest dostępne do wynajęcia. Najemcy zobaczą
          tylko oznaczone terminy.
        </p>
      </div>

      <AvailabilityEditor carId={car.id} initialAvailable={initialAvailable} />
    </div>
  );
}
