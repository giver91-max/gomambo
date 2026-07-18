import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { markAdminNotificationsRead, markNotificationsRead } from "./actions";
import { NotificationDeleteButton } from "./notification-delete-button";
import type { AdminNotification, Notification } from "@/types/database";

const systemTypeLabel: Record<AdminNotification["type"], string> = {
  new_registration: "Nowa rejestracja",
  new_car_pending: "Nowe auto do weryfikacji",
  new_identity_verification: "Zgłoszenie weryfikacji tożsamości",
  new_referral: "Rejestracja z polecenia",
};

const personalTypeLabel: Record<Notification["type"], string> = {
  car_approved: "Auto zatwierdzone",
  car_rejected: "Auto odrzucone",
  booking_accepted: "Rezerwacja zaakceptowana",
  booking_declined: "Rezerwacja odrzucona",
  booking_cancelled: "Rezerwacja anulowana",
  identity_verification_approved: "Tożsamość zweryfikowana",
  identity_verification_rejected: "Weryfikacja tożsamości odrzucona",
  booking_paid: "Płatność za wynajem otrzymana",
  deposit_captured: "Kaucja zatrzymana",
};

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

  await Promise.all([
    markAdminNotificationsRead(unreadSystemIds),
    markNotificationsRead(unreadPersonalIds),
  ]);

  const feed: FeedItem[] = [
    ...system.map((n) => ({
      id: `system-${n.id}`,
      rawId: n.id,
      kind: "system" as const,
      label: systemTypeLabel[n.type],
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      isUnread: !readSystemIds.has(n.id),
    })),
    ...personal.map((n) => ({
      id: `personal-${n.id}`,
      rawId: n.id,
      kind: "personal" as const,
      label: personalTypeLabel[n.type],
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      isUnread: !n.read_at,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
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
            <Card key={notification.id} className={notification.isUnread ? "border-primary/40" : ""}>
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
                    {new Date(notification.createdAt).toLocaleString("pl-PL")}
                  </p>
                  <div className="flex items-center gap-3">
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
