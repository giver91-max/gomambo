import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { markAdminNotificationsRead } from "./actions";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only returns rows for admins — RLS restricts admin_notifications to is_admin().
  const [{ data: rawSystem }, { data: systemReads }] = await Promise.all([
    supabase
      .from("admin_notifications")
      .select("id, type, body, link, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("admin_notification_reads").select("notification_id").eq("user_id", user!.id),
  ]);

  const system = rawSystem ?? [];
  const readSystemIds = new Set((systemReads ?? []).map((r) => r.notification_id));
  const unreadSystemIds = system.filter((n) => !readSystemIds.has(n.id)).map((n) => n.id);
  await markAdminNotificationsRead(unreadSystemIds);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Powiadomienia</h1>

      {system.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnych powiadomień od GoMambo.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {system.map((notification) => (
            <Card
              key={notification.id}
              className={readSystemIds.has(notification.id) ? "" : "border-primary/40"}
            >
              <CardContent className="space-y-1 py-4">
                <p className="text-sm font-medium">
                  {notification.type === "new_registration" ? "Nowa rejestracja" : "Nowe auto do weryfikacji"}
                </p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{notification.body}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {new Date(notification.created_at).toLocaleString("pl-PL")}
                  </p>
                  {notification.link && (
                    <Link href={notification.link} className="text-xs text-primary hover:underline">
                      Zobacz →
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
