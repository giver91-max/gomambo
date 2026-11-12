import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Shown instead of the catalogue while site_settings.maintenance_mode is on.
// That lasts weeks, not minutes — the catalogue opens once there is enough
// to choose from — so it says what IS possible already: owners and rental
// companies can add their cars now and go live on day one.
export function MaintenanceNotice() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">Startujemy wkrótce</h1>
      <p className="max-w-md text-muted-foreground">
        Zbieramy teraz auta od właścicieli i wypożyczalni. Katalog dla najemców otworzymy, gdy
        będzie w czym wybierać.
      </p>
      <p className="max-w-md text-muted-foreground">
        Masz auto albo prowadzisz wypożyczalnię? Dodaj auta już dziś — pojawią się w katalogu od
        pierwszego dnia.
      </p>
      <Link href="/zostan-wlascicielem" className={buttonVariants()}>
        Dodaj swoje auto →
      </Link>
    </div>
  );
}
