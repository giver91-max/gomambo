import type { Metadata } from "next";
import Link from "next/link";
import { getHandoffByToken } from "@/lib/verification-handoff";
import { buttonVariants } from "@/components/ui/button";
import { VERIFICATION_PATH } from "@/lib/links";
import { HandoffPhoneFlow } from "./handoff-phone-flow";

export const metadata: Metadata = {
  title: "Weryfikacja tożsamości",
  robots: { index: false, follow: false },
};

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export default async function VerifyHandoffPage({ params }: { params: { token: string } }) {
  const handoff = await getHandoffByToken(params.token);

  // Worded without assuming a QR code or a second device: the session may
  // have been opened with "Otwórz na tym telefonie", and the person may have
  // finished from the profile form since. The way on is the profile, which
  // shows the current status and makes a fresh code if one is still needed.
  if (!handoff || ["expired", "cancelled"].includes(handoff.status)) {
    const cancelled = handoff?.status === "cancelled";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">{cancelled ? "Ta sesja jest zamknięta" : "Link wygasł"}</h1>
        <p className="max-w-sm text-base text-muted-foreground">
          {cancelled
            ? "W profilu na GoMambo utworzono nowy kod albo wysłano zdjęcia z formularza, więc ta sesja została zamknięta. Status weryfikacji sprawdzisz w profilu."
            : handoff
              ? // No button named: the profile the link below opens labels
                // it differently on a computer and on a phone (see
                // NEW_CODE_HINT in actions.ts).
                "Ta sesja weryfikacji wygasła. Jeśli weryfikacja nie jest jeszcze zakończona, utwórz nowy kod w profilu na GoMambo, w sekcji „Weryfikacja tożsamości”."
              : "Ten link jest nieprawidłowy albo nieaktualny. Weryfikację dokończysz w profilu na GoMambo."}
        </p>
        <Link href={VERIFICATION_PATH} className={buttonVariants({ size: "lg", className: "w-full max-w-sm" })}>
          Przejdź do weryfikacji w profilu →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <HandoffPhoneFlow
          token={params.token}
          initialStatus={handoff.status}
          maskedEmail={maskEmail(handoff.email)}
          // Only whether each photo is in, never the paths: a reload resumes
          // at the first missing one instead of redoing the licence.
          savedPhotos={{
            front: !!handoff.document_front_path,
            back: !!handoff.document_back_path,
            selfie: !!handoff.selfie_path,
          }}
        />
      </div>
    </div>
  );
}
