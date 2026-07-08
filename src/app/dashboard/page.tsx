import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CarStatus } from "@/types/database";
import { BackButton } from "@/components/back-button";

const statusLabel: Record<CarStatus, string> = {
  pending: "Oczekuje na zatwierdzenie",
  approved: "Zatwierdzone",
  rejected: "Odrzucone",
};

const statusVariant: Record<CarStatus, "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cars } = await supabase
    .from("cars")
    .select("*")
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <BackButton />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Moje auta</h1>
        <Link href="/dashboard/cars/new" className={buttonVariants()}>
          + Dodaj auto
        </Link>
      </div>

      {!cars || cars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie dodałeś jeszcze żadnego auta.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cars.map((car) => (
            <Card key={car.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base">
                  {car.brand} {car.model} ({car.year})
                </CardTitle>
                <Badge variant={statusVariant[car.status]}>
                  {statusLabel[car.status]}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{car.city}</p>
                <p>{Number(car.price_per_day).toFixed(2)} zł / dzień</p>
                {car.status === "rejected" && car.rejection_reason && (
                  <p className="text-destructive">
                    Powód odrzucenia: {car.rejection_reason}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link
                    href={`/dashboard/cars/${car.id}/edit`}
                    className="inline-block text-sm text-primary hover:underline"
                  >
                    Edytuj →
                  </Link>
                  <Link
                    href={`/dashboard/cars/${car.id}/availability`}
                    className="inline-block text-sm text-primary hover:underline"
                  >
                    Zarządzaj dostępnością →
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
