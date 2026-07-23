import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { toISODate, addDays } from "@/lib/calendar";
import { summarizeAvailableRanges } from "@/lib/availability-summary";

const AVAILABILITY_WINDOW_DAYS = 60;

// A birds-eye view across every car an owner has, instead of clicking
// into each one individually — a plain table, not a calendar grid: it
// reuses the same date-range summarization already built for the
// per-car cards on /dashboard, so a fleet with a handful of cars doesn't
// need a new visual component to stay in sync with.
export default async function FleetCalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cars } = await supabase
    .from("cars")
    .select("id, brand, model, status")
    .eq("owner_id", user!.id)
    .in("status", ["approved", "paused"])
    .order("created_at", { ascending: false });

  const carIds = (cars ?? []).map((c) => c.id);
  const todayIso = toISODate(new Date());
  const windowEndIso = toISODate(addDays(new Date(), AVAILABILITY_WINDOW_DAYS));

  const availabilityByCarId = new Map<string, string[]>();
  const upcomingByCarId = new Map<string, { start_date: string; end_date: string }[]>();

  if (carIds.length > 0) {
    const [{ data: availabilityRows }, { data: bookingRows }] = await Promise.all([
      supabase
        .from("car_availability")
        .select("car_id, date")
        .in("car_id", carIds)
        .gte("date", todayIso)
        .lte("date", windowEndIso)
        .order("date", { ascending: true }),
      supabase
        .from("bookings")
        .select("car_id, start_date, end_date")
        .in("car_id", carIds)
        .eq("status", "accepted")
        .gte("end_date", todayIso)
        .order("start_date", { ascending: true }),
    ]);

    for (const row of availabilityRows ?? []) {
      const dates = availabilityByCarId.get(row.car_id) ?? [];
      dates.push(row.date);
      availabilityByCarId.set(row.car_id, dates);
    }
    for (const row of bookingRows ?? []) {
      const list = upcomingByCarId.get(row.car_id) ?? [];
      list.push({ start_date: row.start_date, end_date: row.end_date });
      upcomingByCarId.set(row.car_id, list);
    }
  }

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Kalendarz floty</h1>

      {!cars || cars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Brak aktywnych ogłoszeń do pokazania.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Auto</th>
                <th className="p-3 font-medium">Dostępność (najbliższe {AVAILABILITY_WINDOW_DAYS} dni)</th>
                <th className="p-3 font-medium">Nadchodzące rezerwacje</th>
              </tr>
            </thead>
            <tbody>
              {cars.map((car) => {
                const { ranges, extraCount } = summarizeAvailableRanges(
                  availabilityByCarId.get(car.id) ?? []
                );
                const upcoming = upcomingByCarId.get(car.id) ?? [];
                return (
                  <tr key={car.id} className="border-t">
                    <td className="p-3">
                      <Link
                        href={`/dashboard/cars/${car.id}/edit`}
                        className="font-medium text-primary hover:underline"
                      >
                        {car.brand} {car.model}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {ranges.length > 0 ? (
                        <>
                          {ranges.join(", ")}
                          {extraCount > 0 ? ` +${extraCount} innych` : ""}
                        </>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-500">Brak ustawionej dostępności</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {upcoming.length > 0
                        ? upcoming.map((b, i) => (
                            <span key={i} className="block">
                              {b.start_date} – {b.end_date}
                            </span>
                          ))
                        : "Brak"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
