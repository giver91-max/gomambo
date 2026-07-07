"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, type AuthActionState } from "../actions";
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

const initialState: AuthActionState = { error: null };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [state, setState] = useState<AuthActionState>(initialState);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";

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
          <CardTitle>Zaloguj się do GoMambo</CardTitle>
          <CardDescription>Panel właściciela i administratora.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-4">
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Hasło</Label>
              <Input
                id="password"
                name="password"
                type="password"
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
          </form>
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
