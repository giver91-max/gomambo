import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { AdminNav } from "@/components/admin-nav";
import { getUnreadCounts } from "@/lib/notifications";

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
  // starting the other fetches too.
  const [
    { data: profile },
    { unreadMessages, unreadNotifications },
    { count: pendingCars },
    { count: pendingVerifications },
  ] = await Promise.all([
    supabase.from("profiles").select("role, full_name").eq("id", user.id).single(),
    getUnreadCounts(supabase, user.id),
    supabase.from("cars").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("identity_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
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
          pendingCars={pendingCars ?? 0}
          unreadMessages={unreadMessages}
          pendingVerifications={pendingVerifications ?? 0}
        />
        {children}
      </main>
    </div>
  );
}
