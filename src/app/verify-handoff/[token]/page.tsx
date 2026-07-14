import type { Metadata } from "next";
import { getHandoffByToken } from "@/lib/verification-handoff";
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <Card>
          <CardContent className="space-y-2 py-8 text-center">
            <h1 className="text-lg font-semibold">Link wygasł</h1>
            <p className="text-sm text-muted-foreground">
              Ta sesja weryfikacji nie jest już aktywna. Wygeneruj nowy kod QR na koncie, z którego
              rozpocząłeś weryfikację.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-6 py-10">
      <HandoffPhoneFlow token={params.token} initialStatus={handoff.status} maskedEmail={maskEmail(handoff.email)} />
    </div>
  );
}
