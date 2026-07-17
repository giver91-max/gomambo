"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function AdminNav({
  pendingCars,
  unreadMessages,
  pendingVerifications,
}: {
  pendingCars: number;
  unreadMessages: number;
  pendingVerifications: number;
}) {
  const pathname = usePathname();

  const items = [
    { href: "/admin", label: "Przegląd", exact: true, count: 0 },
    { href: "/admin/cars", label: "Samochody", exact: false, count: pendingCars },
    { href: "/admin/users", label: "Użytkownicy", exact: false, count: 0 },
    { href: "/admin/bookings", label: "Rezerwacje", exact: false, count: 0 },
    { href: "/admin/reviews", label: "Recenzje", exact: false, count: 0 },
    { href: "/admin/messages", label: "Wiadomości", exact: false, count: unreadMessages },
    { href: "/admin/conversations", label: "Rozmowy", exact: false, count: 0 },
    {
      href: "/admin/verifications",
      label: "Weryfikacja tożsamości",
      exact: false,
      count: pendingVerifications,
    },
  ];

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b">
      {items.map((item) => {
        const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm",
              isActive
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
            {item.count > 0 && <Badge className="h-5 px-1.5">{item.count}</Badge>}
          </Link>
        );
      })}
    </nav>
  );
}
