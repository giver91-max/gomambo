"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheckIcon,
  BellIcon,
  CalendarCheckIcon,
  CarIcon,
  ChevronDownIcon,
  HeartIcon,
  InboxIcon,
  LogOutIcon,
  MessageCircleIcon,
  SendIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const itemClassName =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted";

export function UserMenu({
  displayName,
  role,
  unreadMessages = 0,
  unreadNotifications = 0,
}: {
  displayName: string;
  role: "owner" | "admin";
  unreadMessages?: number;
  unreadNotifications?: number;
}) {
  const totalUnread = unreadMessages + unreadNotifications;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  return (
    <div className="group relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm hover:bg-muted"
      >
        <span className="max-w-40 truncate">{displayName}</span>
        {totalUnread > 0 && <Badge>{totalUnread}</Badge>}
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform group-hover:rotate-180 group-focus-within:rotate-180",
            open && "rotate-180"
          )}
        />
      </button>

      <div
        onClick={() => setOpen(false)}
        className={cn(
          "invisible absolute right-0 top-full z-20 w-56 rounded-lg border bg-popover p-1.5 opacity-0 shadow-md transition-opacity",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
          open && "visible opacity-100"
        )}
      >
        <Link href="/dashboard/notifications" className={itemClassName}>
          <BellIcon className="size-4 text-muted-foreground" />
          Powiadomienia
          {unreadNotifications > 0 && <Badge className="ml-auto">{unreadNotifications}</Badge>}
        </Link>
        <Link href="/dashboard" className={itemClassName}>
          <CarIcon className="size-4 text-muted-foreground" />
          Moje auta
        </Link>
        <Link href="/dashboard/bookings" className={itemClassName}>
          <InboxIcon className="size-4 text-muted-foreground" />
          Zapytania
        </Link>
        <Link href="/dashboard/rentals" className={itemClassName}>
          <CalendarCheckIcon className="size-4 text-muted-foreground" />
          Moje rezerwacje
        </Link>
        <Link href="/dashboard/messages" className={itemClassName}>
          <MessageCircleIcon className="size-4 text-muted-foreground" />
          Wiadomości
          {unreadMessages > 0 && <Badge className="ml-auto">{unreadMessages}</Badge>}
        </Link>
        <Link href="/dashboard/favorites" className={itemClassName}>
          <HeartIcon className="size-4 text-muted-foreground" />
          Ulubione
        </Link>
        <Link href="/dashboard/profile" className={itemClassName}>
          <UserIcon className="size-4 text-muted-foreground" />
          Mój profil
        </Link>

        {role === "admin" && (
          <>
            <div className="my-1.5 h-px bg-border" />
            <Link href="/admin" className={itemClassName}>
              <ShieldIcon className="size-4 text-muted-foreground" />
              Panel admina
            </Link>
            <Link href="/admin/users" className={itemClassName}>
              <UsersIcon className="size-4 text-muted-foreground" />
              Użytkownicy
            </Link>
            <Link href="/admin/messages" className={itemClassName}>
              <SendIcon className="size-4 text-muted-foreground" />
              Wiadomości do użytkowników
            </Link>
            <Link href="/admin/verifications" className={itemClassName}>
              <BadgeCheckIcon className="size-4 text-muted-foreground" />
              Weryfikacja tożsamości
            </Link>
          </>
        )}

        <div className="my-1.5 h-px bg-border" />
        <form action={signOut}>
          <button type="submit" className={cn(itemClassName, "w-full text-left")}>
            <LogOutIcon className="size-4 text-muted-foreground" />
            Wyloguj
          </button>
        </form>
      </div>
    </div>
  );
}
