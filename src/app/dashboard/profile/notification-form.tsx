"use client";

import { useState, useTransition } from "react";
import { updateNotificationPrefs } from "./actions";
import { cn } from "@/lib/utils";

export function NotificationForm({ initialEmailEnabled }: { initialEmailEnabled: boolean }) {
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [isPending, startTransition] = useTransition();

  function handleToggle(next: boolean) {
    setEmailEnabled(next);
    startTransition(async () => {
      const formData = new FormData();
      if (next) formData.set("notify_email", "on");
      await updateNotificationPrefs(formData);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div>
          <p className="font-medium">Powiadomienia e-mail</p>
          <p className="text-sm text-muted-foreground">
            Nowe zapytania o wynajem, wiadomości i aktualizacje statusu ogłoszeń.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={emailEnabled}
          disabled={isPending}
          onClick={() => handleToggle(!emailEnabled)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
            emailEnabled ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              emailEnabled ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-3 opacity-50">
        <div>
          <p className="font-medium">Powiadomienia SMS</p>
          <p className="text-sm text-muted-foreground">Wkrótce dostępne.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={false}
          disabled
          className="relative h-6 w-11 shrink-0 rounded-full bg-muted"
        >
          <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow" />
        </button>
      </div>
    </div>
  );
}
