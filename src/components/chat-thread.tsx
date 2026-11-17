"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { APP_TIME_ZONE } from "@/lib/calendar";

// Pinned to Polish time: this renders on the server (UTC on Vercel) and again
// in the browser, and without a time zone the two disagreed on every message,
// so React threw the server HTML away and re-rendered the whole page.
const MESSAGE_TIME = new Intl.DateTimeFormat("pl-PL", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

// onDelete is only passed by admin-moderation views (admin/messages,
// admin/conversations) — regular participant chat renders this component
// without it, so the delete affordance never shows there.
export function ChatThread({
  messages,
  currentUserId,
  onDelete,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  onDelete?: (messageId: string) => Promise<unknown>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // The moderation actions report a failure as { error }; the message used to
  // disappear from the screen even when it had not been deleted.
  function handleDelete(messageId: string) {
    if (!onDelete) return;
    setDeleteError(null);
    startTransition(async () => {
      try {
        const result = await onDelete(messageId);
        const failure =
          result && typeof result === "object" && "error" in result
            ? (result as { error: unknown }).error
            : null;
        if (failure) {
          setDeleteError(typeof failure === "string" ? failure : "Nie udało się usunąć wiadomości.");
          return;
        }
        setHiddenIds((prev) => new Set(prev).add(messageId));
      } catch {
        setDeleteError("Nie udało się usunąć wiadomości — sprawdź połączenie i spróbuj ponownie.");
      }
    });
  }

  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border p-4">
      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
      {messages
        .filter((message) => !hiddenIds.has(message.id))
        .map((message) => {
          const isMine = message.senderId === currentUserId;
          return (
            <div key={message.id} className={cn("group flex", isMine ? "justify-end" : "justify-start")}>
              <div className="max-w-[80%] space-y-1">
                <div className="relative">
                  <div
                    className={cn(
                      "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                      isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                  >
                    {message.body}
                  </div>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(message.id)}
                      disabled={isPending}
                      className="absolute -right-2 -top-2 hidden size-5 rounded-full bg-black/70 text-xs text-white group-hover:block"
                      aria-label="Usuń wiadomość"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className={cn("text-xs text-muted-foreground", isMine ? "text-right" : "text-left")}>
                  {MESSAGE_TIME.format(new Date(message.createdAt))}
                </p>
              </div>
            </div>
          );
        })}
      <div ref={bottomRef} />
    </div>
  );
}
