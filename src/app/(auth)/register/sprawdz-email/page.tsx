import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { ResendConfirmation } from "../../resend-confirmation";

export const metadata: Metadata = {
  title: "Sprawdź skrzynkę",
};

export default function CheckEmailPage({
  searchParams,
}: {
  searchParams: { next?: string | string[] };
}) {
  // Where the person was heading when they signed up (/zostan-wlascicielem
  // sends next=/dashboard/cars/new, a mail link may carry
  // /dashboard/profile?krok=weryfikacja); the login link and a resent
  // confirmation link both carry it on.
  const next = safeRedirectPath(
    Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Sprawdź swoją skrzynkę</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Wysłaliśmy link potwierdzający na podany adres email. Kliknij go,
            żeby aktywować konto, a potem się zaloguj.
          </p>
          <Link
            href={{ pathname: "/login", query: { redirect: next } }}
            className="text-sm underline underline-offset-4"
          >
            Przejdź do logowania
          </Link>
          {/* Supabase sends nothing to an address that already has an
              account (and this page must not say which addresses do), so the
              way out for that case is spelled out here for everyone. */}
          <div className="space-y-3 border-t pt-4 text-left">
            <p className="text-sm text-muted-foreground">
              Nie przyszedł e-mail? Sprawdź folder ze spamem. Jeśli masz już konto z tym
              adresem, nowego linku nie wyślemy —{" "}
              <Link
                href={{ pathname: "/login", query: { redirect: next } }}
                className="underline underline-offset-4"
              >
                zaloguj się
              </Link>{" "}
              albo użyj{" "}
              <Link href="/zapomniane-haslo" className="underline underline-offset-4">
                „Nie pamiętasz hasła?”
              </Link>
              . W przeciwnym razie wyślij link jeszcze raz:
            </p>
            <ResendConfirmation next={next} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
