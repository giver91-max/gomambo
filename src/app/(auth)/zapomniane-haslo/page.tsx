"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestPasswordReset, type AuthActionState } from "../actions";
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
  const [state, setState] = useState<AuthActionState>(initialState);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const token = await getRecaptchaToken("forgot_password");
      formData.set("recaptchaToken", token ?? "");
      const result = await requestPasswordReset(initialState, formData);
      setState(result);
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BackButton />
          <CardTitle>Zapomniałeś hasła?</CardTitle>
          <CardDescription>
            Podaj adres e-mail powiązany z kontem — wyślemy link do ustawienia nowego
            hasła.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.success ? (
            <p className="text-sm text-muted-foreground">
              Jeśli podany adres e-mail jest powiązany z kontem, wysłaliśmy na niego
              link do ustawienia nowego hasła.
            </p>
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
