import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { stripeMode, type StripeMode } from "@/lib/stripe";
import { findDeletedAccountLinks } from "@/lib/notifications";
import { MaintenanceModeToggle } from "./maintenance-mode-toggle";
import { RecentActivityItem } from "./recent-activity-item";
import { getAdminQueueCounts } from "./queue-counts";
import type { AdminNotification } from "@/types/database";

const UNREAD_SHOWN = 8;
const RECENT_WINDOW = 50;

const notificationTypeLabel: Record<AdminNotification["type"], string> = {
  new_registration: "Nowa rejestracja",
  new_car_pending: "Nowe auto do weryfikacji",
  new_identity_verification: "Zgłoszenie weryfikacji tożsamości",
  new_referral: "Rejestracja z polecenia",
  commission_fallback: "Prowizja: naliczono stawkę domyślną",
  refund_failed: "Zwrot w Stripe nie powiódł się",
  deposit_release_failed: "Nie zwolniono kaucji (dawny system)",
  bank_transfer_declared: "Zadeklarowany przelew",
  damage_reported: "Zgłoszenie do wynajmu",
  booking_verification_escalated: "Weryfikacja przed wynajmem",
  // Also raised when a company sends its first document or answers a
  // "Poproś o poprawki" request (dashboard/firma) — the row body says which.
  new_partner_pending: "Wypożyczalnia do sprawdzenia",
  deposit_refund_failed: "Zwrot kaucji nie powiódł się",
  deposit_transfer_failed: "Przelew zatrzymanej kaucji nie powiódł się",
  deposit_overdue: "Kaucja: przekroczony termin",
  deposit_objection: "Sprzeciw wobec zatrzymania kaucji",
  payment_disputed: "Reklamacja płatności w banku",
};

// Read from the key's prefix on the server; the key itself is never sent.
const stripeModeNotice: Record<StripeMode, { title: string; body: string; warn: boolean }> = {
  live: {
    title: "Stripe: tryb produkcyjny",
    body: "Płatności i wypłaty są prawdziwe.",
    warn: false,
  },
  test: {
    title: "Stripe: tryb testowy",
    body: "Prawdziwe pieniądze nie płyną. Właściciele nie widzą jeszcze konfiguracji wypłat — pojawi się, gdy w Vercel zostanie ustawiony klucz produkcyjny (sk_live_…).",
    warn: true,
  },
  unknown: {
    title: "Stripe: nierozpoznany klucz",
    body: "STRIPE_SECRET_KEY nie zaczyna się od sk_test_/sk_live_ — sprawdź zmienną w Vercel.",
    warn: true,
  },
  none: {
    title: "Stripe: brak klucza",
    body: "Płatności są wyłączone — w Vercel nie ma STRIPE_SECRET_KEY.",
    warn: true,
  },
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
    { data: siteSettings },
    { data: recentActivity },
    queues,
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
    supabase.from("site_settings").select("maintenance_mode").eq("id", 1).single(),
    // Read a wider window than we display: the list shows what is still
    // UNREAD, so it has to be filtered after the read markers come back.
    supabase
      .from("admin_notifications")
      .select("id, type, body, link, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(RECENT_WINDOW),
    // The same counts as the nav badges, from the same request-scoped cache.
    getAdminQueueCounts(),
  ]);

  const { data: activityReads } = await supabase
    .from("admin_notification_reads")
    .select("notification_id")
    .eq("user_id", user!.id);
  const readActivityIds = new Set((activityReads ?? []).map((r) => r.notification_id));
  const allUnread = (recentActivity ?? []).filter((n) => !readActivityIds.has(n.id));
  const unreadActivity = allUnread.slice(0, UNREAD_SHOWN);
  const deadLinks = await findDeletedAccountLinks(supabase, unreadActivity.map((n) => n.link));

  const pendingCars = (carStatuses ?? []).filter((c) => c.status === "pending").length;
  const approvedCars = (carStatuses ?? []).filter((c) => c.status === "approved").length;
  const pausedCars = (carStatuses ?? []).filter((c) => c.status === "paused").length;

  const stats: { label: string; value: number; href?: string }[] = [
    { label: "Użytkownicy", value: userCount ?? 0, href: "/admin/users" },
    { label: "Auta oczekujące", value: pendingCars, href: "/admin/cars?status=pending" },
    { label: "Auta zatwierdzone", value: approvedCars, href: "/admin/cars?status=approved" },
    { label: "Auta wstrzymane", value: pausedCars, href: "/admin/cars?status=paused" },
    { label: "Aktywne rezerwacje", value: activeBookings ?? 0 },
    { label: "Weryfikacje oczekujące", value: queues.pendingVerifications, href: "/admin/verifications" },
  ];

  // What is actually waiting, from the queues themselves. This list used to
  // be the unread notifications: opening the bell emptied it ("Nic nie
  // czeka") while fifteen verifications waited, and decided ones stayed in it.
  const toReview: { label: string; count: number; href: string }[] = [
    { label: "Weryfikacje tożsamości", count: queues.pendingVerifications, href: "/admin/verifications" },
    { label: "Auta do zatwierdzenia", count: queues.pendingCars, href: "/admin/cars?status=pending" },
    { label: "Wypożyczalnie do weryfikacji", count: queues.pendingPartners, href: "/admin/partnerzy" },
    { label: "Przelewy do potwierdzenia", count: queues.pendingTransfers, href: "/admin/przelewy" },
    { label: "Kaucje do decyzji", count: queues.depositCases, href: "/admin/kaucje" },
    { label: "Otwarte zgłoszenia do wynajmu", count: queues.openReports, href: "/admin/zgloszenia" },
    { label: "Weryfikacje przed wynajmem", count: queues.openVerifications, href: "/admin/weryfikacje-najmu" },
  ].filter((item) => item.count > 0);

  const stripeNotice = stripeModeNotice[stripeMode()];

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Przegląd</h1>

      <MaintenanceModeToggle initialEnabled={siteSettings?.maintenance_mode ?? false} />

      <div
        className={
          stripeNotice.warn
            ? "rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3"
            : "rounded-lg border p-3"
        }
      >
        <p className="font-medium">{stripeNotice.title}</p>
        <p className="text-sm text-muted-foreground">{stripeNotice.body}</p>
      </div>

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
        {toReview.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nic nie czeka na decyzję.</p>
        ) : (
          <Card>
            <CardContent className="divide-y py-1">
              {toReview.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary"
                >
                  <span>{item.label}</span>
                  <span className="font-semibold">{item.count} →</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">Nowe powiadomienia</h2>
        {unreadActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Brak nowych powiadomień. Wszystkie znajdziesz w{" "}
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
                label={notificationTypeLabel[item.type] ?? "Powiadomienie"}
                body={item.body}
                link={item.link}
                accountDeleted={!!item.link && deadLinks.has(item.link)}
                createdAt={item.created_at}
              />
            ))}
            {allUnread.length > unreadActivity.length && (
              <p className="text-sm text-muted-foreground">
                I jeszcze {allUnread.length - unreadActivity.length}
                {(recentActivity ?? []).length >= RECENT_WINDOW ? "+" : ""} — wszystkie w{" "}
                <Link href="/dashboard/notifications" className="text-primary hover:underline">
                  Powiadomieniach
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
