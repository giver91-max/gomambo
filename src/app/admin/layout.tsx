import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // bookings/booking_extra_charges have no admin RLS policy — only the two
  // participants can read a row — so the transfer badge has to be counted
  // with the service-role client. Nothing derived from it is rendered
  // before the role check below redirects a non-admin away.
  const admin = createAdminClient();
  const [
    { data: profile },
    { unreadMessages, unreadNotifications },
    { count: pendingCars },
    { count: pendingVerifications },
    { count: pendingBookingTransfers },
    { count: pendingChargeTransfers },
    { count: openReports },
    { count: openVerifications },
    { count: pendingPartners },
  ] = await Promise.all([
    supabase.from("profiles").select("role, full_name").eq("id", user.id).single(),
    getUnreadCounts(supabase, user.id),
    supabase.from("cars").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("identity_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("payment_method", "bank_transfer")
      .eq("payment_status", "unpaid")
      .in("status", ["accepted", "completed"]),
    admin
      .from("booking_extra_charges")
      .select("id", { count: "exact", head: true })
      .eq("payment_method", "bank_transfer")
      .eq("status", "requested"),
    admin
      .from("damage_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    admin
      .from("booking_verifications")
      .select("booking_id", { count: "exact", head: true })
      .eq("status", "escalated"),
    admin
      .from("partners")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  const pendingTransfers = (pendingBookingTransfers ?? 0) + (pendingChargeTransfers ?? 0);

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
          pendingTransfers={pendingTransfers}
          openReports={openReports ?? 0}
          openVerifications={openVerifications ?? 0}
          pendingPartners={pendingPartners ?? 0}
        />
        {children}
      </main>
    </div>
  );
}
