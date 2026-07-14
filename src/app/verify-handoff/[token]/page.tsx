import type { Metadata } from "next";
import { getHandoffByToken } from "@/lib/verification-handoff";
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

  if (!handoff || ["expired", "cancelled"].includes(handoff.status)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">Link wygasł</h1>
        <p className="max-w-sm text-base text-muted-foreground">
          Ta sesja weryfikacji nie jest już aktywna. Wygeneruj nowy kod QR na koncie, z którego
          rozpocząłeś weryfikację.
        </p>
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
        />
      </div>
    </div>
  );
}
