import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompleteProfileForm } from "./complete-profile-form";

export const metadata: Metadata = {
  title: "Dokończ zakładanie konta",
  robots: { index: false, follow: false },
};

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const redirectTo = safeRedirectPath(searchParams.redirect);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Straight to the final target after login (the middleware brings the
  // person back through this page if it still applies), so the target and
  // its query survive.
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, terms_version")
    .eq("id", user.id)
    .single();

  // Already complete — nothing to gate, send them straight on.
  if (profile?.full_name && profile?.phone) {
    redirect(redirectTo);
  }

  // Accounts from before phone numbers were collected already have a name —
  // tell them what is actually missing, and that the terms come next (the
  // middleware's next gate), so the second screen is no surprise.
  const onlyPhoneMissing = !!profile?.full_name;
  const termsNext = profile?.terms_version !== CURRENT_TERMS_VERSION;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Dokończ zakładanie konta</CardTitle>
          <CardDescription>
            {onlyPhoneMissing
              ? "Brakuje nam jeszcze Twojego numeru telefonu — to podstawa weryfikacji konta na GoMambo."
              : "Zanim przejdziesz dalej, potrzebujemy Twojego imienia, nazwiska i numeru telefonu — to podstawa weryfikacji konta na GoMambo."}
            {termsNext && " Potem jeszcze tylko akceptacja regulaminu."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompleteProfileForm
            fullName={profile?.full_name ?? ""}
            phone={profile?.phone ?? ""}
            redirectTo={redirectTo}
          />
        </CardContent>
      </Card>
    </div>
  );
}
