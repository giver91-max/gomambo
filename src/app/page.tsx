import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">GoMambo</h1>
      <p className="max-w-md text-muted-foreground">
        Wypożyczaj i udostępniaj samochody między sąsiadami. Dołącz jako
        właściciel i dodaj swoje pierwsze auto.
      </p>
      <div className="flex gap-3">
        <Link href="/register" className={buttonVariants()}>
          Zostań właścicielem
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Zaloguj się
        </Link>
      </div>
    </div>
  );
}
