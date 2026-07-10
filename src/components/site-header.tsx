import Link from "next/link";
import { UserMenu } from "@/components/user-menu";

export function SiteHeader({
  email,
  fullName,
  role,
  unreadMessages = 0,
}: {
  email: string;
  fullName?: string;
  role: "owner" | "admin";
  unreadMessages?: number;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-4 sm:px-6">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
        <Link href="/auta" className="hover:underline">
          Przeglądaj auta
        </Link>
        <UserMenu
          displayName={fullName || email}
          role={role}
          unreadMessages={unreadMessages}
        />
      </nav>
    </header>
  );
}
