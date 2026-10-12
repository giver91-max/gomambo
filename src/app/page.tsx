import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing-page";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName = "Panel";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();
    displayName = profile?.full_name || "Panel";
  }

  return <LandingPage isLoggedIn={!!user} displayName={displayName} />;
}
