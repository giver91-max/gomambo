import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SiteHeader({
  email,
  role,
  unreadMessages = 0,
}: {
  email: string;
  role: "owner" | "admin";
  unreadMessages?: number;
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
        <Link href="/dashboard/favorites" className="hover:underline">
          Ulubione
        </Link>
        <Link href="/dashboard/bookings" className="hover:underline">
          Zapytania
        </Link>
        <Link href="/dashboard/rentals" className="hover:underline">
          Moje rezerwacje
        </Link>
        <Link href="/dashboard/messages" className="flex items-center gap-1.5 hover:underline">
          Wiadomości
          {unreadMessages > 0 && <Badge>{unreadMessages}</Badge>}
        </Link>
        {role === "admin" && (
          <Link href="/admin" className="hover:underline">
            Panel admina
          </Link>
        )}
        <Link href="/dashboard/profile" className="hover:underline">
          Mój profil
        </Link>
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
