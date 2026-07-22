import { redirect } from "next/navigation";
import { NewCarForm } from "./new-car-form";
import { BackButton } from "@/components/back-button";
import { VerificationRequiredNotice } from "@/components/verification-required-notice";
import { createClient } from "@/lib/supabase/server";
import { getVerificationStatus } from "@/lib/verification-gate";

export default async function NewCarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { status, rejectionReason } = await getVerificationStatus(supabase, user.id);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Dodaj auto</h1>
      {status === "approved" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Po dodaniu auto trafi do weryfikacji przez administratora. Otrzymasz
            informację, gdy zostanie zatwierdzone lub odrzucone.
          </p>
          <NewCarForm />
        </>
      ) : (
        <VerificationRequiredNotice status={status} rejectionReason={rejectionReason} />
      )}
    </div>
  );
}
