"use client";

import { useState, useTransition } from "react";
import { deleteAdminNotification, deleteNotification } from "./actions";

export function NotificationDeleteButton({
  id,
  kind,
}: {
  id: string;
  kind: "personal" | "system";
}) {
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const action = kind === "personal" ? deleteNotification : deleteAdminNotification;
      const result = await action(id);
      if (result.error) {
        setError(result.error);
      } else {
        setHidden(true);
      }
    });
  }

  if (hidden) return null;

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-muted-foreground hover:text-destructive"
        aria-label="Usuń powiadomienie"
      >
        {isPending ? "Usuwanie…" : "Usuń"}
      </button>
    </span>
  );
}
