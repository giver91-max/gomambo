"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, requestLoginCode, verifyLoginCode, type AuthActionState } from "../actions";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type Mode = "password" | "otp-request" | "otp-verify";

function LoginForm() {
  const [state, setState] = useState<AuthActionState>(initialState);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("password");
  const [otpEmail, setOtpEmail] = useState("");
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";

  function switchMode(next: Mode) {
    setState(initialState);
    setMode(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const token = await getRecaptchaToken("login");
      formData.set("recaptchaToken", token ?? "");
      const result = await signIn(initialState, formData);
      // signIn redirects on success instead of returning a value — only
      // update state on failure, otherwise the page is already navigating away.
      if (result) setState(result);
    });
  }

  function handleRequestCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    startTransition(async () => {
      const token = await getRecaptchaToken("login_otp_request");
      formData.set("recaptchaToken", token ?? "");
      const result = await requestLoginCode(initialState, formData);
      setState(result);
      if (result.success) {
        setOtpEmail(email);
        setMode("otp-verify");
      }
    });
  }

  function handleVerifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await verifyLoginCode(initialState, formData);
      // verifyLoginCode redirects on success — only update state on failure.
      if (result) setState(result);
    });
  }

  // Pressing Enter in a text input should submit the form like a native
  // submit button does; make that explicit instead of relying on the
  // browser's implicit-submission heuristic to fire onSubmit reliably.
  function handleKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BackButton />
          <CardTitle>Zaloguj się do GoMambo</CardTitle>
          <CardDescription>Panel właściciela i administratora.</CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "password" && (
            <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-4">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Hasło</Label>
                  <Link
                    href="/zapomniane-haslo"
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Zapomniałeś hasła?
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Chwileczkę…" : "Zaloguj się"}
              </Button>
              <button
                type="button"
                onClick={() => switchMode("otp-request")}
                className="w-full text-center text-xs text-muted-foreground hover:underline"
              >
                Zaloguj się kodem z e-maila
              </button>
            </form>
          )}

          {mode === "otp-request" && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Podaj adres e-mail — wyślemy na niego jednorazowy kod do zalogowania.
              </p>
              <div className="space-y-2">
                <Label htmlFor="otp-email">Email</Label>
                <Input id="otp-email" name="email" type="email" required autoComplete="email" />
              </div>
              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Wysyłanie…" : "Wyślij kod"}
              </Button>
              <button
                type="button"
                onClick={() => switchMode("password")}
                className="w-full text-center text-xs text-muted-foreground hover:underline"
              >
                Wróć do logowania hasłem
              </button>
            </form>
          )}

          {mode === "otp-verify" && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="email" value={otpEmail} />
              <p className="text-sm text-muted-foreground">
                Jeśli <strong>{otpEmail}</strong> jest powiązany z kontem, wysłaliśmy na niego
                6-cyfrowy kod. Wpisz go poniżej.
              </p>
              <div className="space-y-2">
                <Label htmlFor="code">Kod</Label>
                <Input
                  id="code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                />
              </div>
              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Sprawdzanie…" : "Zaloguj się"}
              </Button>
              <button
                type="button"
                onClick={() => switchMode("otp-request")}
                className="w-full text-center text-xs text-muted-foreground hover:underline"
              >
                Wyślij kod ponownie / zmień adres e-mail
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Nie masz konta?{" "}
            <Link
              href={{ pathname: "/register", query: { next: redirectTo } }}
              className="underline underline-offset-4"
            >
              Zarejestruj się
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
