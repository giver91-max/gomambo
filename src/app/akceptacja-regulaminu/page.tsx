import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { CURRENT_TERMS_LABEL, CURRENT_TERMS_VERSION } from "@/lib/terms";
import { AcceptTermsForm } from "./accept-terms-form";

/**
 * Where the dashboard sends anyone who has not accepted the Regulamin now in
 * force: accounts from before the checkbox existed, and everyone after the
 * text changes (CURRENT_TERMS_VERSION in src/lib/terms.ts).
 */
export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const redirectTo = safeRedirectPath(searchParams.redirect);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/akceptacja-regulaminu")}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("terms_version, terms_accepted_at")
    .eq("id", user.id)
    .single();

  if (profile?.terms_version === CURRENT_TERMS_VERSION) {
    redirect(redirectTo);
  }
  const hadEarlierVersion = !!profile?.terms_accepted_at;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{hadEarlierVersion ? "Zmieniliśmy regulamin" : "Zaakceptuj regulamin"}</CardTitle>
          <CardDescription>
            {hadEarlierVersion
              ? `Obowiązuje nowa wersja Regulaminu z ${CURRENT_TERMS_LABEL}. Przeczytaj ją i zaakceptuj, żeby dalej korzystać z panelu.`
              : "Twoje konto powstało, zanim rejestracja wymagała akceptacji Regulaminu. Zanim przejdziesz dalej, zapoznaj się z nim i zaakceptuj go."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptTermsForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </div>
  );
}
