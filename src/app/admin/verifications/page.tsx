import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/back-button";
import { cn } from "@/lib/utils";
import { adminFileUrl } from "../plik/url";
import { VerificationReviewCard } from "./verification-review-card";
import type {
  AutoReview,
  FaceMatchResult,
  IdentityVerificationStatus,
  VerificationMethod,
} from "@/types/database";

const TABS: { value: IdentityVerificationStatus; label: string }[] = [
  { value: "pending", label: "Oczekujące" },
  { value: "approved", label: "Zweryfikowane" },
  { value: "rejected", label: "Odrzucone" },
];

// The queue opens on what still needs a decision, oldest first — the person
// who has waited longest is at the top. It used to list every verification
// ever made, newest first, so decided ones sat between the pending ones and
// every visit downloaded all their photos too. Decided ones are one tab away.
export default async function AdminVerificationsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status: IdentityVerificationStatus =
    TABS.find((t) => t.value === searchParams.status)?.value ?? "pending";

  const supabase = await createClient();
  const { data: rawVerifications } = await supabase
    .from("identity_verifications")
    .select(
      "id, document_path, document_back_path, selfie_path, status, rejection_reason, verification_method, face_match_result, face_match_score, auto_review, created_at, user:profiles!identity_verifications_user_id_fkey(full_name)"
    )
    .eq("status", status)
    .order("created_at", { ascending: status === "pending" });

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
    auto_review: AutoReview | null;
    created_at: string;
    user: { full_name: string } | null;
  }[];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Weryfikacja tożsamości</h1>

      <div className="flex flex-wrap gap-2 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/verifications?status=${tab.value}`}
            className={cn(
              "px-3 py-2 text-sm",
              status === tab.value
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {verifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status === "pending" ? "Nic nie czeka na decyzję." : "Brak zgłoszeń."}
        </p>
      ) : (
        <div className="space-y-4">
          {verifications.map((v) => (
            <VerificationReviewCard
              key={v.id}
              verification={v}
              userName={v.user?.full_name || "Użytkownik"}
              // Stable links signed on demand (see ../plik/route.ts), so the
              // photos survive a re-render and a lazy load after five minutes.
              documentUrl={adminFileUrl("dokument", v.id, v.document_path)}
              documentBackUrl={
                v.document_back_path
                  ? adminFileUrl("dokument-tyl", v.id, v.document_back_path)
                  : null
              }
              selfieUrl={v.selfie_path ? adminFileUrl("selfie", v.id, v.selfie_path) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
