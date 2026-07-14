"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signUp, type AuthActionState } from "../actions";
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

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const [state, setState] = useState<AuthActionState>(initialState);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const ref = searchParams.get("ref") ?? "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const token = await getRecaptchaToken("register");
      formData.set("recaptchaToken", token ?? "");
      const result = await signUp(initialState, formData);
      // signUp redirects on success instead of returning a value — only
      // update state on failure, otherwise the page is already navigating away.
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
          <CardTitle>Zostań właścicielem na GoMambo</CardTitle>
          <CardDescription>
            Załóż konto, żeby dodawać samochody do wypożyczenia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="ref" value={ref} />
            <div className="space-y-2">
              <Label htmlFor="fullName">Imię i nazwisko</Label>
              <Input id="fullName" name="fullName" required autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Hasło</Label>
              <PasswordInput
                id="password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="flex items-start gap-2">
              <input
                id="acceptTerms"
                name="acceptTerms"
                type="checkbox"
                required
                className="mt-1 size-4 shrink-0 rounded border-input"
              />
              <Label htmlFor="acceptTerms" className="text-sm font-normal text-muted-foreground">
                Akceptuję{" "}
                <Link href="/regulamin" target="_blank" className="underline underline-offset-4">
                  Regulamin
                </Link>{" "}
                i{" "}
                <Link
                  href="/polityka-prywatnosci"
                  target="_blank"
                  className="underline underline-offset-4"
                >
                  Politykę prywatności
                </Link>
                .
              </Label>
            </div>
            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Chwileczkę…" : "Zarejestruj się"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Masz już konto?{" "}
            <Link
              href={{ pathname: "/login", query: { redirect: next } }}
              className="underline underline-offset-4"
            >
              Zaloguj się
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
