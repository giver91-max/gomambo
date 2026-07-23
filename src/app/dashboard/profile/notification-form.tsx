"use client";

import { useState, useTransition } from "react";
import { updateNotificationPrefs } from "./actions";
import { cn } from "@/lib/utils";

export function NotificationForm({
  initialEmailEnabled,
  initialSmsEnabled,
  hasPhone,
}: {
  initialEmailEnabled: boolean;
  initialSmsEnabled: boolean;
  hasPhone: boolean;
}) {
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [smsEnabled, setSmsEnabled] = useState(initialSmsEnabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(nextEmail: boolean, nextSms: boolean, revertEmail: boolean, revertSms: boolean) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const formData = new FormData();
      if (nextEmail) formData.set("notify_email", "on");
      if (nextSms) formData.set("notify_sms", "on");
      const result = await updateNotificationPrefs(formData);
      if (result.error) {
        setEmailEnabled(revertEmail);
        setSmsEnabled(revertSms);
        setError(result.error);
      } else {
        setSaved(true);
      }
    });
  }

  function handleEmailToggle(next: boolean) {
    const previous = emailEnabled;
    setEmailEnabled(next);
    submit(next, smsEnabled, previous, smsEnabled);
  }

  function handleSmsToggle(next: boolean) {
    if (next && !hasPhone) {
      setError("Podaj numer telefonu powyżej, zanim włączysz powiadomienia SMS.");
      return;
    }
    const previous = smsEnabled;
    setSmsEnabled(next);
    submit(emailEnabled, next, emailEnabled, previous);
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
          onClick={() => handleEmailToggle(!emailEnabled)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
            emailEnabled ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              emailEnabled ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div>
          <p className="font-medium">Powiadomienia SMS</p>
          <p className="text-sm text-muted-foreground">
            {hasPhone
              ? "Najważniejsze aktualizacje (rezerwacje, płatności) na Twój numer telefonu."
              : "Podaj numer telefonu powyżej, żeby włączyć."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={smsEnabled}
          disabled={isPending || !hasPhone}
          onClick={() => handleSmsToggle(!smsEnabled)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
            smsEnabled ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              smsEnabled ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-muted-foreground">Zapisano.</p>}
    </div>
  );
}
