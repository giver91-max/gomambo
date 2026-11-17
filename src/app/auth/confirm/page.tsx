import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { linkFailurePath } from "../link-failure";
import { confirmTarget, emailLinkType, type EmailLinkType } from "./link-params";
import { ConfirmLinkForm } from "./confirm-link-form";

export const metadata: Metadata = {
  title: "Potwierdzenie z e-maila",
  robots: { index: false, follow: false },
};

const COPY: Record<EmailLinkType, { title: string; description: string; button: string }> = {
  email: {
    title: "Potwierdź adres e-mail",
    description: "Jeszcze jedno kliknięcie i konto w GoMambo będzie aktywne.",
    button: "Potwierdzam adres e-mail",
  },
  signup: {
    title: "Potwierdź adres e-mail",
    description: "Jeszcze jedno kliknięcie i konto w GoMambo będzie aktywne.",
    button: "Potwierdzam adres e-mail",
  },
  recovery: {
    title: "Ustaw nowe hasło",
    description: "Kliknij poniżej, żeby przejść do ustawienia nowego hasła.",
    button: "Przejdź do ustawienia hasła",
  },
  email_change: {
    title: "Potwierdź nowy adres e-mail",
    description: "Kliknij poniżej, żeby potwierdzić zmianę adresu e-mail w GoMambo.",
    button: "Potwierdzam zmianę adresu",
  },
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Landing page for the token_hash links in the Supabase e-mail templates
 * (see confirmEmailLink for why it waits for a click).
 */
export default function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const tokenHash = first(searchParams.token_hash) ?? "";
  const type = emailLinkType(first(searchParams.type));
  const next = confirmTarget(type, first(searchParams.next), first(searchParams.redirect_to));

  if (!tokenHash || !type) {
    redirect(linkFailurePath(next));
  }

  const copy = COPY[type];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConfirmLinkForm tokenHash={tokenHash} type={type} next={next} buttonLabel={copy.button} />
          <p className="text-xs text-muted-foreground">
            Ten dodatkowy krok chroni link przed programami pocztowymi, które same otwierają
            linki z wiadomości — mogłyby go zużyć, zanim ktokolwiek go kliknie.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
