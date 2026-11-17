import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { AdminNav } from "@/components/admin-nav";
import { getUnreadCounts } from "@/lib/notifications";
import { getAdminQueueCounts } from "./queue-counts";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Middleware already redirects non-admins away from /admin/*, so this
  // pays off in the common case by not waiting on the profile query before
  // starting the other fetches too. The queue counts are shared with the
  // overview page (see queue-counts.ts); nothing derived from them is
  // rendered before the role check below redirects a non-admin away.
  const [{ data: profile }, { unreadMessages, unreadNotifications }, queues] = await Promise.all([
    supabase.from("profiles").select("role, full_name").eq("id", user.id).single(),
    getUnreadCounts(supabase, user.id),
    getAdminQueueCounts(),
  ]);

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen">
      <SiteHeader
        email={user.email ?? ""}
        fullName={profile?.full_name ?? ""}
        role="admin"
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
      />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <AdminNav
          pendingCars={queues.pendingCars}
          unreadMessages={unreadMessages}
          pendingVerifications={queues.pendingVerifications}
          pendingTransfers={queues.pendingTransfers}
          openReports={queues.openReports}
          openVerifications={queues.openVerifications}
          pendingPartners={queues.pendingPartners}
          depositCases={queues.depositCases}
        />
        {children}
      </main>
    </div>
  );
}
