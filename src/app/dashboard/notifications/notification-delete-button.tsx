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
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const action = kind === "personal" ? deleteNotification : deleteAdminNotification;
      const result = await action(id);
      if (!result.error) {
        setHidden(true);
      }
    });
  }

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="text-xs text-muted-foreground hover:text-destructive"
      aria-label="Usuń powiadomienie"
    >
      Usuń
    </button>
  );
}
