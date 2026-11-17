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
import { safeRedirectPath } from "@/lib/safe-redirect";
import { BackButton } from "@/components/back-button";
import { SUBMIT_FAILED_MESSAGE } from "../auth-errors";
import { ResendConfirmation } from "../resend-confirmation";

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
  const searchParams = useSearchParams();
  // tryb=kod opens straight on the e-mail code form — the way in that works
  // on any device, which the "link did not work" notices point to.
  const [mode, setMode] = useState<Mode>(
    searchParams.get("tryb") === "kod" ? "otp-request" : "password"
  );
  const [otpEmail, setOtpEmail] = useState("");
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  // The address the password form was last sent with — what "Wyślij link
  // ponownie" uses when the account turns out to be unconfirmed.
  const [passwordEmail, setPasswordEmail] = useState("");
  // The whole path and query (e.g. /dashboard/profile?krok=weryfikacja): the
  // middleware puts both into ?redirect=, and signIn / verifyLoginCode take
  // the person there.
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  // /auth/callback sends a link that did not work here (blad=link) instead
  // of dropping the person on a login form with no word of explanation.
  const linkFailed = searchParams.get("blad") === "link";
  // /auth/confirm confirmed the address but signs nobody in (a forwarded
  // link must not log a stranger into the account it was issued for), so it
  // sends the person here to log in themselves.
  const confirmed = searchParams.get("potwierdzono");

  function switchMode(next: Mode) {
    setState(initialState);
    setMode(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPasswordEmail(String(formData.get("email") ?? "").trim());
    startTransition(async () => {
      try {
        const token = await getRecaptchaToken("login");
        formData.set("recaptchaToken", token ?? "");
        const result = await signIn(initialState, formData);
        // signIn redirects on success instead of returning a value — only
        // update state on failure, otherwise the page is already navigating away.
        if (result) setState(result);
      } catch {
        setState({ error: SUBMIT_FAILED_MESSAGE });
      }
    });
  }

  function handleRequestCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    startTransition(async () => {
      try {
        const token = await getRecaptchaToken("login_otp_request");
        formData.set("recaptchaToken", token ?? "");
        const result = await requestLoginCode(initialState, formData);
        setState(result);
        if (result.success) {
          setOtpEmail(email);
          setOtpNotice(result.notice ?? null);
          setMode("otp-verify");
        }
      } catch {
        setState({ error: SUBMIT_FAILED_MESSAGE });
      }
    });
  }

  function handleVerifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await verifyLoginCode(initialState, formData);
        // verifyLoginCode redirects on success — only update state on failure.
        if (result) setState(result);
      } catch {
        setState({ error: SUBMIT_FAILED_MESSAGE });
      }
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
          {linkFailed && (
            <p className="mb-4 rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
              Link z e-maila nie zadziałał — wygasł, został już użyty albo otworzył się w innej
              przeglądarce niż ta, w której o niego proszono. Jeśli potwierdzał adres e-mail,
              konto jest najpewniej już aktywne: zaloguj się poniżej hasłem albo kodem z e-maila
              (kod działa na każdym urządzeniu).
            </p>
          )}
          {confirmed && !linkFailed && (
            <p className="mb-4 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              {confirmed === "zmiana"
                ? "Link potwierdzający zmianę adresu e-mail zadziałał ✓ Jeśli wiadomość z linkiem przyszła na oba adresy (stary i nowy), kliknij link w każdej z nich. Potem zaloguj się poniżej."
                : "Adres e-mail potwierdzony ✓ Zaloguj się poniżej hasłem albo kodem z e-maila, żeby przejść dalej."}
            </p>
          )}
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
                    Nie pamiętasz hasła?
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
          {mode === "password" && state.unconfirmed && passwordEmail && (
            <div className="mt-4">
              <ResendConfirmation key={passwordEmail} email={passwordEmail} next={redirectTo} />
            </div>
          )}

          {mode === "otp-request" && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <input type="hidden" name="redirectTo" value={redirectTo} />
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
              {otpNotice ? (
                <p className="text-sm text-muted-foreground">{otpNotice}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Jeśli <strong>{otpEmail}</strong> jest powiązany z kontem, wysłaliśmy na niego
                    6-cyfrowy kod. Wpisz go poniżej.
                  </p>
                  {/* Supabase answers a code request for an account that never
                      confirmed its address with the "Confirm signup" e-mail. */}
                  <p className="text-xs text-muted-foreground">
                    Jeśli konto nie zostało jeszcze aktywowane, przyjdzie wiadomość z linkiem
                    aktywacyjnym — kliknij go, a potem zaloguj się hasłem albo kodem.
                  </p>
                </>
              )}
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
