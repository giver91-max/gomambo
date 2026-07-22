import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { IdentityVerificationStatus } from "@/types/database";

// Shown in place of "add a car" / "send a booking inquiry" whenever the
// account hasn't cleared identity verification yet — the one gate that
// applies identically to owners and renters, since GoMambo has a single
// unified account type.
export function VerificationRequiredNotice({
  status,
  rejectionReason,
}: {
  status: IdentityVerificationStatus | null;
  rejectionReason?: string | null;
}) {
  if (status === "pending") {
    return (
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p>
          Twoja weryfikacja tożsamości czeka na sprawdzenie przez administratora.
          Odezwiemy się, gdy tylko ją zatwierdzimy.
        </p>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p className="text-destructive">
          Twoja weryfikacja tożsamości została odrzucona
          {rejectionReason ? `: ${rejectionReason}` : "."}
        </p>
        <Button render={<Link href="/dashboard/profile" />}>Popraw weryfikację →</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-4 text-sm">
      <p>
        Zweryfikuj tożsamość i prawo jazdy, zanim to zrobisz — zajmuje to około 5
        minut i robimy to raz.
      </p>
      <Button render={<Link href="/dashboard/profile" />}>Zweryfikuj tożsamość →</Button>
    </div>
  );
}
