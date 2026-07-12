import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { getUnreadCounts } from "@/lib/notifications";

export default async function DashboardLayout({
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

  const [{ data: profile }, { unreadMessages, unreadNotifications }] = await Promise.all([
    supabase.from("profiles").select("role, full_name").eq("id", user.id).single(),
    getUnreadCounts(supabase, user.id),
  ]);

  return (
    <div className="min-h-screen">
      <SiteHeader
        email={user.email ?? ""}
        fullName={profile?.full_name ?? ""}
        role={profile?.role ?? "owner"}
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
      />
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
