import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/back-button";
import { VerificationReviewCard } from "./verification-review-card";
import type { FaceMatchResult, IdentityVerificationStatus, VerificationMethod } from "@/types/database";

export default async function AdminVerificationsPage() {
  const supabase = await createClient();
  const { data: rawVerifications } = await supabase
    .from("identity_verifications")
    .select(
      "id, document_path, document_back_path, selfie_path, status, rejection_reason, verification_method, face_match_result, face_match_score, user:profiles!identity_verifications_user_id_fkey(full_name)"
    )
    .order("created_at", { ascending: false });

  const verifications = (rawVerifications ?? []) as unknown as {
    id: string;
    document_path: string;
    document_back_path: string | null;
    selfie_path: string | null;
    status: IdentityVerificationStatus;
    rejection_reason: string | null;
    verification_method: VerificationMethod;
    face_match_result: FaceMatchResult;
    face_match_score: number | null;
    user: { full_name: string } | null;
  }[];

  const withUrls = await Promise.all(
    verifications.map(async (v) => {
      const { data: signed } = await supabase.storage
        .from("id-documents")
        .createSignedUrl(v.document_path, 60 * 5);
      const documentBackUrl = v.document_back_path
        ? (await supabase.storage.from("id-documents").createSignedUrl(v.document_back_path, 60 * 5)).data
            ?.signedUrl ?? null
        : null;
      const selfieUrl = v.selfie_path
        ? (await supabase.storage.from("id-documents").createSignedUrl(v.selfie_path, 60 * 5)).data
            ?.signedUrl ?? null
        : null;
      return { ...v, documentUrl: signed?.signedUrl ?? null, documentBackUrl, selfieUrl };
    })
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Weryfikacja tożsamości</h1>

      {withUrls.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak zgłoszeń.</p>
      ) : (
        <div className="space-y-4">
          {withUrls.map((v) => (
            <VerificationReviewCard
              key={v.id}
              verification={v}
              userName={v.user?.full_name || "Użytkownik"}
              documentUrl={v.documentUrl}
              documentBackUrl={v.documentBackUrl}
              selfieUrl={v.selfieUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
