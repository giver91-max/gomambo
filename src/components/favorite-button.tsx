"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { HeartIcon } from "lucide-react";
import { toggleFavorite } from "@/app/dashboard/favorites/actions";
import { cn } from "@/lib/utils";

export function FavoriteButton({
  carId,
  initialFavorited,
  isLoggedIn,
}: {
  carId: string;
  initialFavorited: boolean;
  isLoggedIn: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();

  const baseClassName =
    "absolute right-2 top-2 z-10 flex size-9 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm transition-colors hover:bg-black/70";

  if (!isLoggedIn) {
    return (
      <Link
        href="/login"
        onClick={(e) => e.stopPropagation()}
        className={baseClassName}
        aria-label="Zaloguj się, aby dodać do ulubionych"
      >
        <HeartIcon className="size-5 text-white" />
      </Link>
    );
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !favorited;
    setFavorited(next);
    startTransition(async () => {
      const result = await toggleFavorite(carId);
      if (result.error) {
        setFavorited(!next);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={favorited}
      aria-label={favorited ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
      className={baseClassName}
    >
      <HeartIcon
        className={cn("size-5", favorited ? "fill-primary text-primary" : "text-white")}
      />
    </button>
  );
}
