import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { cn } from "@/lib/utils";
import { formatDateTimePl } from "@/lib/calendar";
import { findDeletedAccountLinks } from "@/lib/notifications";
import { markAdminNotificationsRead, markNotificationsRead } from "./actions";
import { NotificationDeleteButton } from "./notification-delete-button";
import { RefreshOnce } from "./refresh-once";
import type { AdminNotification, Notification } from "@/types/database";

const systemTypeLabel: Record<AdminNotification["type"], string> = {
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

const personalTypeLabel: Record<Notification["type"], string> = {
  car_approved: "Auto zatwierdzone",
  car_rejected: "Auto odrzucone",
  car_documents: "Dokumenty auta",
  booking_accepted: "Rezerwacja zaakceptowana",
  booking_declined: "Rezerwacja odrzucona",
  booking_cancelled: "Rezerwacja anulowana",
  identity_verification_approved: "Tożsamość zweryfikowana",
  identity_verification_rejected: "Weryfikacja tożsamości odrzucona",
  booking_paid: "Płatność za wynajem otrzymana",
  deposit_captured: "Kaucja zatrzymana lub rozliczona",
  booking_confirmed: "Nowa rezerwacja potwierdzona",
  extra_charge_requested: "Prośba o dodatkową opłatę",
  booking_extended: "Wynajem przedłużony",
  payment_failed: "Płatność nie powiodła się",
  damage_reported: "Zgłoszenie do wynajmu",
  booking_verification_requested: "Potwierdź tożsamość przed odbiorem",
  booking_verification_pending_owner: "Najemca czeka na Twoje potwierdzenie",
  booking_verification_approved: "Tożsamość potwierdzona",
  deposit_requested: "Wpłać kaucję",
  deposit_paid: "Kaucja wpłacona",
  deposit_review: "Rozliczenie kaucji",
  deposit_refunded: "Zwrot kaucji",
  deposit_overdue: "Kaucja niewpłacona",
  deposit_objection: "Sprzeciw wobec zatrzymania kaucji",
  partner_approved: "Wypożyczalnia zweryfikowana",
  partner_changes_requested: "Wypożyczalnia: prośba o poprawki",
  partner_status_changed: "Status wypożyczalni",
};

// Before 0053 a decision about a rental company was filed under the car
// types, so the company read "Auto zatwierdzone" over "you can add cars now".
// Those rows (and any written while 0053 is not yet applied) are told apart
// by where they point: only a company decision links to /dashboard/firma.
function personalLabel(type: Notification["type"], link: string | null): string {
  if (link === "/dashboard/firma") {
    if (type === "car_approved") return personalTypeLabel.partner_approved;
    if (type === "car_rejected") return personalTypeLabel.partner_status_changed;
  }
  return personalTypeLabel[type] ?? "Powiadomienie";
}

type FeedItem = {
  id: string;
  rawId: string;
  kind: "personal" | "system";
  label: string;
  body: string;
  link: string | null;
  createdAt: string;
  isUnread: boolean;
};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // admin_notifications only ever returns rows for admins — RLS restricts
  // it to is_admin(). notifications is the per-user feed everyone gets.
  const [{ data: rawSystem }, { data: systemReads }, { data: rawPersonal }] = await Promise.all([
    supabase
      .from("admin_notifications")
      .select("id, type, body, link, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("admin_notification_reads").select("notification_id").eq("user_id", user!.id),
    supabase
      .from("notifications")
      .select("id, type, body, link, read_at, created_at")
      .eq("user_id", user!.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const system = rawSystem ?? [];
  const readSystemIds = new Set((systemReads ?? []).map((r) => r.notification_id));
  const unreadSystemIds = system.filter((n) => !readSystemIds.has(n.id)).map((n) => n.id);

  const personal = rawPersonal ?? [];
  const unreadPersonalIds = personal.filter((n) => !n.read_at).map((n) => n.id);

  const [deadLinks] = await Promise.all([
    findDeletedAccountLinks(supabase, system.map((n) => n.link)),
    markAdminNotificationsRead(unreadSystemIds),
    markNotificationsRead(unreadPersonalIds),
  ]);

  const feed: FeedItem[] = [
    ...system.map((n) => {
      // A "Nowa rejestracja" whose account has since been deleted: say so
      // rather than link to a 404.
      const accountGone = !!n.link && deadLinks.has(n.link);
      return {
        id: `system-${n.id}`,
        rawId: n.id,
        kind: "system" as const,
        label: systemTypeLabel[n.type] ?? "Powiadomienie",
        body: accountGone ? `${n.body}\n(To konto zostało już usunięte.)` : n.body,
        link: accountGone ? null : n.link,
        createdAt: n.created_at,
        isUnread: !readSystemIds.has(n.id),
      };
    }),
    ...personal.map((n) => ({
      id: `personal-${n.id}`,
      rawId: n.id,
      kind: "personal" as const,
      label: personalLabel(n.type, n.link),
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      isUnread: !n.read_at,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      {/* Clears the stale unread badge in the header the moment this page has
          marked things read, instead of on the next full reload. */}
      <RefreshOnce when={unreadSystemIds.length > 0 || unreadPersonalIds.length > 0} />
      <h1 className="text-2xl font-bold">Powiadomienia</h1>

      {feed.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych powiadomień od GoMambo.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {feed.map((notification) => (
            <Card
              key={notification.id}
              className={cn("relative", notification.isUnread && "border-primary/40")}
            >
              {/* Makes the whole card clickable (matching the messages list),
                  not just the small "Zobacz" link — sits behind the action
                  row below via z-index so those controls stay independently
                  clickable. */}
              {notification.link && (
                <Link href={notification.link} className="absolute inset-0 z-10" aria-hidden="true" tabIndex={-1} />
              )}
              <CardContent className="space-y-1 py-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {notification.isUnread && (
                    <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Nieprzeczytane" />
                  )}
                  {notification.label}
                </p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{notification.body}</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimePl(notification.createdAt)}
                  </p>
                  <div className="relative z-10 flex items-center gap-3">
                    {notification.link && (
                      <Link href={notification.link} className="text-xs text-primary hover:underline">
                        Zobacz →
                      </Link>
                    )}
                    <NotificationDeleteButton id={notification.rawId} kind={notification.kind} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
