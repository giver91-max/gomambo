import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { AvatarManager } from "@/components/avatar-manager";
import { IdentityVerificationManager } from "@/components/identity-verification-manager";
import { ProfileForm } from "./profile-form";
import { EmailForm } from "./email-form";
import { NotificationForm } from "./notification-form";

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
