import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Set here as well as by Next itself: otherwise the 404 page also carried the
// root layout's "index, follow" next to Next's own "noindex".
export const metadata: Metadata = {
  title: "Nie ma takiej strony",
  robots: { index: false, follow: true },
};

/**
 * Every unknown address, and every notFound() — a mistyped or cut-off link,
 * an /auta/<id> that is hidden while the catalogue is closed, a car id that
 * is not the person's own. It used to be Next's English default with no way
 * back but the browser's back button.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <p className="text-sm font-semibold text-primary">Błąd 404</p>
          <CardTitle>Nie ma takiej strony</CardTitle>
          <CardDescription>
            Ten adres nie istnieje albo strona nie jest teraz dostępna. Jeśli link przyszedł
            e-mailem, sprawdź, czy nie został ucięty.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link href="/" className={buttonVariants({ className: "w-full" })}>
            Wróć na stronę główną
          </Link>
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", className: "w-full" })}>
            Przejdź do panelu
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
