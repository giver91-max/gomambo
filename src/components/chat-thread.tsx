"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export function ChatThread({
  messages,
  currentUserId,
}: {
  messages: ChatMessage[];
  currentUserId: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border p-4">
      {messages.map((message) => {
        const isMine = message.senderId === currentUserId;
        return (
          <div key={message.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
            <div className="max-w-[80%] space-y-1">
              <div
                className={cn(
                  "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                  isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {message.body}
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
