"use client";

import { useFormState } from "react-dom";
import Link from "next/link";
import { signUp, type AuthActionState } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubmitButton } from "@/components/submit-button";

const initialState: AuthActionState = { error: null };

export default function RegisterPage() {
  const [state, formAction] = useFormState(signUp, initialState);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-semibold">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Zostań właścicielem na GoMambo</CardTitle>
          <CardDescription>
            Załóż konto, żeby dodawać samochody do wypożyczenia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
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
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <SubmitButton>Zarejestruj się</SubmitButton>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Masz już konto?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Zaloguj się
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
