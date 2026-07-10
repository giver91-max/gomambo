import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  const { data: myConversations } = await supabase
    .from("conversations")
    .select("id")
    .or(`owner_id.eq.${user.id},renter_id.eq.${user.id}`);
  const conversationIds = (myConversations ?? []).map((c) => c.id);

  let unreadMessages = 0;
  if (conversationIds.length > 0) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds)
      .neq("sender_id", user.id)
      .is("read_at", null);
    unreadMessages = count ?? 0;
  }

  return (
    <div className="min-h-screen">
      <SiteHeader
        email={user.email ?? ""}
        fullName={profile?.full_name ?? ""}
        role={profile?.role ?? "owner"}
        unreadMessages={unreadMessages}
      />
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
