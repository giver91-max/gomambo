import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";
import { signOut } from "../actions";

export const metadata: Metadata = {
  title: "Ustaw nowe hasło",
};

export default async function SetNewPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/zapomniane-haslo");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Ustaw nowe hasło</CardTitle>
          {/* The reset link signs in whichever account it was issued for, and
              anyone can forward a link from their own mailbox — naming the
              account makes a stranger's one obvious (see confirmEmailLink). */}
          <CardDescription>
            Wpisz nowe hasło do konta GoMambo{" "}
            {user.email ? <strong className="text-foreground">{user.email}</strong> : null}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SetPasswordForm />
          <form action={signOut} className="text-xs text-muted-foreground">
            To nie Twój adres? Nie ustawiaj hasła —{" "}
            <button type="submit" className="underline underline-offset-4">
              wyloguj się
            </button>
            .
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
