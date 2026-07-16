import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { AvatarManager } from "@/components/avatar-manager";
import { IdentityVerificationManager } from "@/components/identity-verification-manager";
import { ProfileForm } from "./profile-form";
import { EmailForm } from "./email-form";
import { NotificationForm } from "./notification-form";
import { ReferralLink } from "@/components/referral-link";
import { StripeConnectManager } from "@/components/stripe-connect-manager";
import { SITE_URL } from "@/lib/site";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/dashboard");
  }

  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : null;
  const fallbackLabel = (profile.full_name || user.email || "?").slice(0, 1).toUpperCase();

  const { data: verification } = await supabase
    .from("identity_verifications")
    .select("status, rejection_reason, document_path, selfie_path")
    .eq("user_id", user.id)
    .maybeSingle();

  let documentUrl: string | null = null;
  if (verification?.document_path) {
    const { data: signed } = await supabase.storage
      .from("id-documents")
      .createSignedUrl(verification.document_path, 60 * 5);
    documentUrl = signed?.signedUrl ?? null;
  }

  let selfieUrl: string | null = null;
  if (verification?.selfie_path) {
    const { data: signed } = await supabase.storage
      .from("id-documents")
      .createSignedUrl(verification.selfie_path, 60 * 5);
    selfieUrl = signed?.signedUrl ?? null;
  }

  const { count: referralCount } = await supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", user.id);
  const referralLink = `${SITE_URL}/register?ref=${user.id}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Mój profil</h1>

      <Card>
        <CardHeader>
          <CardTitle>Zdjęcie profilowe</CardTitle>
        </CardHeader>
        <CardContent>
          <AvatarManager userId={user.id} initialUrl={avatarUrl} fallbackLabel={fallbackLabel} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dane osobowe</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adres e-mail</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailForm email={user.email ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Powiadomienia</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationForm initialEmailEnabled={profile.notify_email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Konto do wypłat</CardTitle>
        </CardHeader>
        <CardContent>
          <StripeConnectManager onboarded={profile.stripe_connect_onboarded} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Program poleceń</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Poleć GoMambo znajomym. Poleciłeś już{" "}
            <span className="font-semibold text-foreground">{referralCount ?? 0}</span>{" "}
            {referralCount === 1 ? "osobę" : "osób"}. Nagrody za polecenia ustalamy na razie
            ręcznie — napisz do nas na czacie po pierwszym poleceniu.
          </p>
          <ReferralLink link={referralLink} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weryfikacja tożsamości</CardTitle>
        </CardHeader>
        <CardContent>
          <IdentityVerificationManager
            userId={user.id}
            initialStatus={verification?.status ?? null}
            initialRejectionReason={verification?.rejection_reason ?? null}
            initialDocumentUrl={documentUrl}
            initialSelfieUrl={selfieUrl}
          />
        </CardContent>
      </Card>
    </div>
  );
}
