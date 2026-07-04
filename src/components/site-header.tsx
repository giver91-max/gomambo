import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function SiteHeader({
  email,
  role,
}: {
  email: string;
  role: "owner" | "admin";
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-4 sm:px-6">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
        <Link href="/dashboard" className="hover:underline">
          Moje auta
        </Link>
        <Link href="/auta" className="hover:underline">
          Przeglądaj auta
        </Link>
        {role === "admin" && (
          <Link href="/admin" className="hover:underline">
            Panel admina
          </Link>
        )}
        <span className="text-muted-foreground">{email}</span>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Wyloguj
          </Button>
        </form>
      </nav>
    </header>
  );
}
