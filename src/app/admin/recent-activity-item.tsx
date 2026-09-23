"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { markAdminNotificationRead } from "@/app/dashboard/notifications/actions";

/**
 * One line of the admin dashboard's activity list.
 *
 * It used to be a plain card with a "Zobacz →" link and no way to get rid of
 * it: you clicked, you were taken to the thing, and the entry was still
 * sitting there when you came back — for ever, because nothing on this page
 * ever marked an admin notification as read. Now following the link marks it,
 * and "Odrzuć" marks it without going anywhere.
 */
export function RecentActivityItem({
  id,
  label,
  body,
  link,
  createdAt,
}: {
  id: string;
  label: string;
  body: string;
  link: string | null;
  createdAt: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handle(destination: string | null) {
    startTransition(async () => {
      await markAdminNotificationRead(id);
      if (destination) router.push(destination);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(createdAt).toLocaleString("pl-PL")}
          </p>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{body}</p>
        <div className="flex items-center gap-4 pt-1">
          {link && (
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
            {isPending ? "Chwileczkę…" : "Odrzuć"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
