import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { IdentityVerificationStatus } from "@/types/database";

// Shown in place of "add a car" / "send a booking inquiry" whenever the
// account hasn't cleared identity verification yet — the one gate that
// applies identically to owners and renters, since GoMambo has a single
// unified account type.
export function VerificationRequiredNotice({
  status,
  rejectionReason,
  purpose = "book",
}: {
  status: IdentityVerificationStatus | null;
  rejectionReason?: string | null;
  /** What the person was trying to do, so the first line names it. */
  purpose?: "add_car" | "book";
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
    <div className="space-y-3 rounded-lg border p-4 text-sm">
      <p className="font-medium text-foreground">
        {purpose === "add_car"
          ? "Aby dodać samochód, musisz zostać zweryfikowany"
          : "Aby zarezerwować auto, musisz zostać zweryfikowany"}
      </p>

      <ul className="space-y-2 text-muted-foreground">
        {/* The SMS route is named because it is coming and people ask for it,
            but it is marked as not yet available rather than offered — an
            option that silently does nothing is worse than none. */}
        <li className="flex flex-wrap items-center gap-2">
          <span>Potwierdzenie kodem SMS</span>
          <Badge variant="secondary">Wkrótce</Badge>
        </li>
        <li>
          <strong className="text-foreground">Selfie i prawo jazdy z obu stron</strong> — zajmuje
          około 5 minut i robisz to raz. Najszybciej telefonem: zeskanujesz kod QR i zrobisz
          zdjęcia aparatem.
        </li>
      </ul>

      <Button render={<Link href="/dashboard/profile" />}>Zweryfikuj się →</Button>
    </div>
  );
}
