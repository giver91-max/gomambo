import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompleteProfileForm } from "./complete-profile-form";

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const redirectTo = searchParams.redirect ?? "/dashboard";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/uzupelnij-dane")}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .single();

  // Already complete — nothing to gate, send them straight on.
  if (profile?.full_name && profile?.phone) {
    redirect(redirectTo);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Dokończ zakładanie konta</CardTitle>
          <CardDescription>
            Zanim przejdziesz dalej, potrzebujemy Twojego imienia, nazwiska i numeru
            telefonu — to podstawa weryfikacji konta na GoMambo.
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
