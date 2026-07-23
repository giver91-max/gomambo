import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { FleetCarList } from "./fleet-car-list";
import { eachDateInRange, toISODate, addDays } from "@/lib/calendar";

const AVAILABILITY_WINDOW_DAYS = 60;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: cars }, { data: bookings }, { data: reviews }] = await Promise.all([
    supabase.from("cars").select("*").eq("owner_id", user!.id).order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("status, start_date, end_date, cars(price_per_day)")
      .eq("owner_id", user!.id),
    supabase.from("reviews").select("rating").eq("reviewee_id", user!.id).is("deleted_at", null),
  ]);

  const activeListings = (cars ?? []).filter(
    (c) => c.status === "approved" || c.status === "paused"
  ).length;
  const pendingRequests = (bookings ?? []).filter((b) => b.status === "requested").length;
  const completedBookings = (bookings ?? []).filter((b) => b.status === "completed");
  const estimatedRevenue = completedBookings.reduce((sum, b) => {
    const nights = eachDateInRange(b.start_date, b.end_date).length;
    const pricePerDay = Number((b.cars as { price_per_day: number } | null)?.price_per_day ?? 0);
    return sum + nights * pricePerDay;
  }, 0);
  const avgRating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  // Only bookable statuses need an at-a-glance availability summary — a
  // pending/rejected car can't take reservations yet regardless of dates set.
  const bookableCarIds = (cars ?? [])
    .filter((c) => c.status === "approved" || c.status === "paused")
    .map((c) => c.id);

  const todayIso = toISODate(new Date());
  const windowEndIso = toISODate(addDays(new Date(), AVAILABILITY_WINDOW_DAYS));

  const availabilityByCarId = new Map<string, string[]>();
  if (bookableCarIds.length > 0) {
    const { data: availabilityRows } = await supabase
      .from("car_availability")
      .select("car_id, date")
      .in("car_id", bookableCarIds)
      .gte("date", todayIso)
      .lte("date", windowEndIso)
      .order("date", { ascending: true });

    for (const row of availabilityRows ?? []) {
      const dates = availabilityByCarId.get(row.car_id) ?? [];
      dates.push(row.date);
      availabilityByCarId.set(row.car_id, dates);
    }
  }

  const stats: { label: string; value: string }[] = [
    { label: "Aktywne ogłoszenia", value: String(activeListings) },
    { label: "Zapytania oczekujące", value: String(pendingRequests) },
    { label: "Zakończone wynajmy", value: String(completedBookings.length) },
    { label: "Szacowany przychód", value: `${estimatedRevenue.toFixed(0)} zł` },
    { label: "Średnia ocena", value: avgRating !== null ? `★ ${avgRating.toFixed(1)}` : "brak ocen" },
  ];

  return (
    <div className="space-y-6">
      <BackButton />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Moje auta</h1>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/kalendarz" className="text-sm text-primary hover:underline">
            Kalendarz floty →
          </Link>
          <Link href="/dashboard/cars/new" className={buttonVariants()}>
            + Dodaj auto
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {completedBookings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Szacowany przychód liczony jest z aktualnej ceny za dzień auta, nie z ceny
          obowiązującej w momencie rezerwacji.
        </p>
      )}

      {!cars || cars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie dodałeś jeszcze żadnego auta.
          </CardContent>
        </Card>
      ) : (
        <FleetCarList cars={cars} availabilityByCarId={Object.fromEntries(availabilityByCarId)} />
      )}
    </div>
  );
}
