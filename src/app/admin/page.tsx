import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { MaintenanceModeToggle } from "./maintenance-mode-toggle";
import type { AdminNotification } from "@/types/database";

const notificationTypeLabel: Record<AdminNotification["type"], string> = {
  new_registration: "Nowa rejestracja",
  new_car_pending: "Nowe auto do weryfikacji",
  new_identity_verification: "Zgłoszenie weryfikacji tożsamości",
};

export default async function AdminOverviewPage() {
  const supabase = await createClient();

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
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", ["requested", "accepted"]),
    supabase
      .from("identity_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("site_settings").select("maintenance_mode").eq("id", 1).single(),
    supabase
      .from("admin_notifications")
      .select("id, type, body, link, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

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
        <h2 className="font-semibold">Ostatnia aktywność</h2>
        {!recentActivity || recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak ostatniej aktywności.</p>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((item) => (
              <Card key={item.id}>
                <CardContent className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{notificationTypeLabel[item.type]}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString("pl-PL")}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                  {item.link && (
                    <Link href={item.link} className="block text-xs text-primary hover:underline">
                      Zobacz →
                    </Link>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
