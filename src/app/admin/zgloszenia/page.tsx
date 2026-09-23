import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { ResolveReportButton } from "./resolve-report-button";

// Service role: damage_reports is readable by the two booking participants
// and by an admin, but the joins below reach bookings and profiles, which
// have no admin SELECT policy at all. /admin/* is gated by middleware and
// the admin layout.
export default async function AdminDamageReportsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const showResolved = searchParams.status === "resolved";
  const admin = createAdminClient();

  const { data: reports } = await admin
    .from("damage_reports")
    .select(
      `id, description, reporter_role, status, created_at, resolved_at,
       damage_report_notes(note),
       reporter:profiles!damage_reports_reporter_id_fkey(full_name),
       bookings(id, start_date, end_date, status, total_price,
                cars(brand, model, year, city))`
    )
    .eq("status", showResolved ? "resolved" : "open")
    .order("created_at", { ascending: false });

  const rows = (reports ?? []) as unknown as {
    id: string;
    description: string;
    reporter_role: "owner" | "renter";
    status: "open" | "resolved";
    created_at: string;
    resolved_at: string | null;
    damage_report_notes: { note: string } | null;
    reporter: { full_name: string } | null;
    bookings: {
      id: string;
      start_date: string;
      end_date: string;
      status: string;
      total_price: number | null;
      cars: { brand: string; model: string; year: number; city: string } | null;
    } | null;
  }[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Zgłoszenia do wynajmów</h1>
        <p className="text-sm text-muted-foreground">
          Szkody, spory i wszystko, co jedna ze stron chciała mieć odnotowane. Każde zgłoszenie
          trafiło też do drugiej strony.
        </p>
      </div>

      <div className="flex gap-2 border-b">
        <a
          href="/admin/zgloszenia"
          className={`px-3 py-2 text-sm ${!showResolved ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
        >
          Otwarte
        </a>
        <a
          href="/admin/zgloszenia?status=resolved"
          className={`px-3 py-2 text-sm ${showResolved ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
        >
          Zamknięte
        </a>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showResolved ? "Brak zamkniętych zgłoszeń." : "Brak otwartych zgłoszeń."}
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((report) => {
            const car = report.bookings?.cars;
            const label = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
            return (
              <Card key={report.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">{label}</CardTitle>
                  <Badge variant={report.reporter_role === "owner" ? "default" : "secondary"}>
                    {report.reporter_role === "owner" ? "Zgłosił właściciel" : "Zgłosił najemca"}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    {report.reporter?.full_name || "—"} ·{" "}
                    {new Date(report.created_at).toLocaleString("pl-PL")}
                  </p>
                  {report.bookings && (
                    <p className="text-xs">
                      {car?.city} · termin {report.bookings.start_date} – {report.bookings.end_date} ·
                      status rezerwacji: {report.bookings.status}
                      {report.bookings.total_price
                        ? ` · ${Number(report.bookings.total_price).toFixed(2)} zł`
                        : ""}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-foreground">
                    {report.description}
                  </p>
                  {report.damage_report_notes?.note && (
                    <p className="text-xs">
                      <strong className="text-foreground">Notatka (tylko dla nas):</strong>{" "}
                      {report.damage_report_notes.note}
                    </p>
                  )}
                  {report.status === "open" ? (
                    <ResolveReportButton reportId={report.id} />
                  ) : (
                    <p className="text-xs">
                      Zamknięte{" "}
                      {report.resolved_at
                        ? new Date(report.resolved_at).toLocaleString("pl-PL")
                        : ""}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
