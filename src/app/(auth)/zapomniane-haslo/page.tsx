"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { requestPasswordReset, type AuthActionState } from "../actions";
import { SUBMIT_FAILED_MESSAGE } from "../auth-errors";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getRecaptchaToken } from "@/lib/recaptcha-client";
import { BackButton } from "@/components/back-button";

const initialState: AuthActionState = { error: null };

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const [state, setState] = useState<AuthActionState>(initialState);
  const [isPending, startTransition] = useTransition();
  // /auth/callback sends a reset link that did not work back here
  // (blad=link) — expired, used, or opened where it was not requested.
  const linkFailed = useSearchParams().get("blad") === "link";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const token = await getRecaptchaToken("forgot_password");
        formData.set("recaptchaToken", token ?? "");
        const result = await requestPasswordReset(initialState, formData);
        setState(result);
      } catch {
        setState({ error: SUBMIT_FAILED_MESSAGE });
      }
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BackButton fallbackHref="/login" />
          <CardTitle>Nie pamiętasz hasła?</CardTitle>
          <CardDescription>
            Podaj adres e-mail powiązany z kontem — wyślemy link do ustawienia nowego
            hasła.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkFailed && !state.success && (
            <p className="mb-4 rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
              Link do ustawienia hasła nie zadziałał — wygasł, został już użyty albo otworzył się
              w innej przeglądarce niż ta, w której o niego proszono. Wyślij nowy poniżej i
              otwórz go na tym samym urządzeniu. Możesz też od razu{" "}
              <Link href="/login?tryb=kod" className="underline underline-offset-4">
                zalogować się kodem z e-maila
              </Link>{" "}
              — działa na każdym urządzeniu.
            </p>
          )}
          {state.success ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Jeśli podany adres e-mail jest powiązany z kontem, wysłaliśmy na niego
                link do ustawienia nowego hasła.
              </p>
              {/* The link is a PKCE one: it only works in the browser that
                  asked for it, which is exactly what tripped people up. */}
              <p>
                Otwórz go na tym samym urządzeniu i w tej samej przeglądarce. Nie działa albo
                nie przyszedł? Możesz{" "}
                <Link href="/login?tryb=kod" className="underline underline-offset-4">
                  zalogować się kodem z e-maila
                </Link>{" "}
                — działa na każdym urządzeniu.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              {state.error && <p className="text-sm text-destructive">{state.error}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Chwileczkę…" : "Wyślij link resetujący"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline underline-offset-4">
              Wróć do logowania
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
