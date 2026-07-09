"use client";

import { useRef } from "react";
import type { StickerRect } from "@/lib/plate-cover";

const MIN_WIDTH = 0.1;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

type DragState =
  | { mode: "move"; startX: number; startY: number; rect: StickerRect }
  | { mode: "resize"; startX: number; startY: number; rect: StickerRect };

export function PlateCoverEditor({
  imageUrl,
  sticker,
  onChange,
}: {
  imageUrl: string;
  sticker: StickerRect | null;
  onChange: (rect: StickerRect) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  function handleMoveStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!sticker) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: "move", startX: e.clientX, startY: e.clientY, rect: sticker };
  }

  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!sticker) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: "resize", startX: e.clientX, startY: e.clientY, rect: sticker };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || !containerRef.current) return;
    const box = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - state.startX) / box.width;
    const dy = (e.clientY - state.startY) / box.height;

    if (state.mode === "move") {
      const x = clamp(state.rect.x + dx, 0, 1 - state.rect.w);
      const y = clamp(state.rect.y + dy, 0, 1 - state.rect.h);
      onChange({ ...state.rect, x, y });
    } else {
      const aspect = state.rect.w / state.rect.h;
      const w = clamp(state.rect.w + dx, MIN_WIDTH, 1 - state.rect.x);
      const h = w / aspect;
      onChange({ ...state.rect, w, h });
    }
  }

  function handlePointerUp() {
    drag.current = null;
  }

  return (
    <div ref={containerRef} className="relative w-full select-none overflow-hidden rounded-md bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" draggable={false} className="block w-full" />
      {sticker && (
        <div
          onPointerDown={handleMoveStart}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            left: `${sticker.x * 100}%`,
            top: `${sticker.y * 100}%`,
            width: `${sticker.w * 100}%`,
            height: `${sticker.h * 100}%`,
          }}
          className="absolute flex touch-none cursor-move items-center justify-center rounded-sm border-2 border-primary bg-white shadow-md"
        >
          <span className="pointer-events-none select-none whitespace-nowrap text-[10px] font-black leading-none text-black sm:text-xs">
            Go<span className="text-primary">Mambo</span>
          </span>
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 touch-none cursor-se-resize rounded-full border-2 border-white bg-primary"
          />
        </div>
      )}
    </div>
  );
}
