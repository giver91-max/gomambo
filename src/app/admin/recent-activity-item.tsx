"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTimePl } from "@/lib/calendar";
import { markAdminNotificationRead } from "@/app/dashboard/notifications/actions";

/**
 * One line of the admin dashboard's activity list.
 *
 * It used to be a plain card with a "Zobacz →" link and no way to get rid of
 * it: you clicked, you were taken to the thing, and the entry was still
 * sitting there when you came back — for ever, because nothing on this page
 * ever marked an admin notification as read. Now following the link marks it,
 * and "Ukryj" marks it without going anywhere. (It was labelled "Odrzuć",
 * the same word as rejecting a verification, though it decides nothing and
 * sends nothing.)
 */
export function RecentActivityItem({
  id,
  label,
  body,
  link,
  accountDeleted = false,
  createdAt,
}: {
  id: string;
  label: string;
  body: string;
  link: string | null;
  // The account this entry points at no longer exists: no link to a 404.
  accountDeleted?: boolean;
  createdAt: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(destination: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await markAdminNotificationRead(id);
        if (result.error && !destination) {
          setError(result.error);
          return;
        }
      } catch {
        if (!destination) {
          setError("Nie udało się ukryć — sprawdź połączenie i spróbuj ponownie.");
          return;
        }
      }
      // Going to the thing matters more than the read marker.
      if (destination) router.push(destination);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{label}</p>
          {/* Polish time on the server AND in the browser: a bare
              toLocaleString rendered UTC on the server and local time in the
              browser, and the mismatch re-rendered the whole page. */}
          <p className="text-xs text-muted-foreground">{formatDateTimePl(createdAt)}</p>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{body}</p>
        {accountDeleted && (
          <p className="text-xs text-muted-foreground">To konto zostało już usunięte.</p>
        )}
        <div className="flex items-center gap-4 pt-1">
          {link && !accountDeleted && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handle(link)}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Zobacz →
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => handle(null)}
            className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
          >
            {isPending ? "Chwileczkę…" : "Ukryj"}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
