"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

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
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function handleDelete(messageId: string) {
    if (!onDelete) return;
    startTransition(async () => {
      await onDelete(messageId);
      setHiddenIds((prev) => new Set(prev).add(messageId));
    });
  }

  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border p-4">
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
                  {new Date(message.createdAt).toLocaleString("pl-PL", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          );
        })}
      <div ref={bottomRef} />
    </div>
  );
}
