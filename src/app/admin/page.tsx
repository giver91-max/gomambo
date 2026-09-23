import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { MaintenanceModeToggle } from "./maintenance-mode-toggle";
import { RecentActivityItem } from "./recent-activity-item";
import type { AdminNotification } from "@/types/database";

const notificationTypeLabel: Record<AdminNotification["type"], string> = {
  new_registration: "Nowa rejestracja",
  new_car_pending: "Nowe auto do weryfikacji",
  new_identity_verification: "Zgłoszenie weryfikacji tożsamości",
  new_referral: "Rejestracja z polecenia",
  commission_fallback: "Prowizja: naliczono stawkę domyślną",
  refund_failed: "Zwrot w Stripe nie powiódł się",
  deposit_release_failed: "Nie zwolniono kaucji",
  bank_transfer_declared: "Zadeklarowany przelew",
  damage_reported: "Zgłoszenie do wynajmu",
  booking_verification_escalated: "Weryfikacja przed wynajmem",
  new_partner_pending: "Nowa wypożyczalnia do weryfikacji",
};

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { count: userCount },
    { data: carStatuses },
    { count: activeBookings },
    { count: pendingVerifications },
    { data: siteSettings },
    { data: recentActivity },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("cars").select("status"),
    // Service role: bookings has no admin SELECT policy — only the two
    // participants can read a row — so a session client counts the admin's
    // own bookings, which is almost always none.
    createAdminClient()
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", ["requested", "accepted"]),
    supabase
      .from("identity_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("site_settings").select("maintenance_mode").eq("id", 1).single(),
    // Read a wider window than we display: the list shows what is still
    // UNREAD, so it has to be filtered after the read markers come back.
    supabase
      .from("admin_notifications")
      .select("id, type, body, link, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const { data: activityReads } = await supabase
    .from("admin_notification_reads")
    .select("notification_id")
    .eq("user_id", user!.id);
  const readActivityIds = new Set((activityReads ?? []).map((r) => r.notification_id));
  const unreadActivity = (recentActivity ?? [])
    .filter((n) => !readActivityIds.has(n.id))
    .slice(0, 8);

  const pendingCars = (carStatuses ?? []).filter((c) => c.status === "pending").length;
  const approvedCars = (carStatuses ?? []).filter((c) => c.status === "approved").length;
  const pausedCars = (carStatuses ?? []).filter((c) => c.status === "paused").length;

  const stats: { label: string; value: number; href?: string }[] = [
    { label: "Użytkownicy", value: userCount ?? 0, href: "/admin/users" },
    { label: "Auta oczekujące", value: pendingCars, href: "/admin/cars?status=pending" },
    { label: "Auta zatwierdzone", value: approvedCars, href: "/admin/cars?status=approved" },
    { label: "Auta wstrzymane", value: pausedCars, href: "/admin/cars?status=paused" },
    { label: "Aktywne rezerwacje", value: activeBookings ?? 0 },
    { label: "Weryfikacje oczekujące", value: pendingVerifications ?? 0, href: "/admin/verifications" },
  ];

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Przegląd</h1>

      <MaintenanceModeToggle initialEnabled={siteSettings?.maintenance_mode ?? false} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => {
          const tile = (
            <Card className={stat.href ? "h-full transition-shadow hover:shadow-md" : "h-full"}>
              <CardContent className="py-4">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          );
          return stat.href ? (
            <Link key={stat.label} href={stat.href}>
              {tile}
            </Link>
          ) : (
            <div key={stat.label}>{tile}</div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">Do sprawdzenia</h2>
        {unreadActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nic nie czeka. Wszystkie powiadomienia znajdziesz w{" "}
            <Link href="/dashboard/notifications" className="text-primary hover:underline">
              Powiadomieniach
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-2">
            {unreadActivity.map((item) => (
              <RecentActivityItem
                key={item.id}
                id={item.id}
                label={notificationTypeLabel[item.type]}
                body={item.body}
                link={item.link}
                createdAt={item.created_at}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
