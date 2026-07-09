"use client";

import { useMemo, useRef } from "react";
import { getBadgeFontSizeCqw, type StickerRect } from "@/lib/plate-cover";

const MIN_WIDTH_FRACTION = 0.08;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

type DragState =
  | { mode: "move"; startX: number; startY: number; rect: StickerRect }
  | {
      mode: "resize";
      startX: number;
      startY: number;
      rect: StickerRect;
      boxWidth: number;
      boxHeight: number;
    }
  | { mode: "rotate"; boxLeft: number; boxTop: number; boxWidth: number; boxHeight: number };

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
  const fontSizeCqw = useMemo(() => getBadgeFontSizeCqw(), []);

  function handleMoveStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!sticker) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: "move", startX: e.clientX, startY: e.clientY, rect: sticker };
  }

  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!sticker || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = containerRef.current.getBoundingClientRect();
    drag.current = {
      mode: "resize",
      startX: e.clientX,
      startY: e.clientY,
      rect: sticker,
      boxWidth: box.width,
      boxHeight: box.height,
    };
  }

  function handleRotateStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!sticker || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = containerRef.current.getBoundingClientRect();
    drag.current = {
      mode: "rotate",
      boxLeft: box.left,
      boxTop: box.top,
      boxWidth: box.width,
      boxHeight: box.height,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || !sticker) return;

    if (state.mode === "move") {
      const box = containerRef.current!.getBoundingClientRect();
      const dx = (e.clientX - state.startX) / box.width;
      const dy = (e.clientY - state.startY) / box.height;
      onChange({ ...state.rect, cx: state.rect.cx + dx, cy: state.rect.cy + dy });
      return;
    }

    if (state.mode === "resize") {
      // Undo the badge's own rotation from the raw screen-space drag delta
      // so growing the handle always feels like "drag outward", regardless
      // of how the badge is currently rotated.
      const dxPx = e.clientX - state.startX;
      const dyPx = e.clientY - state.startY;
      const theta = (state.rect.rotation * Math.PI) / 180;
      const localDx = dxPx * Math.cos(theta) + dyPx * Math.sin(theta);

      const startWPx = state.rect.w * state.boxWidth;
      const startHPx = state.rect.h * state.boxHeight;
      const aspect = startWPx / startHPx;

      const newWPx = clamp(
        startWPx + localDx,
        MIN_WIDTH_FRACTION * state.boxWidth,
        state.boxWidth * 2
      );
      const newHPx = newWPx / aspect;

      // Keep the opposite (local top-left) corner anchored: the center has
      // to shift by half the size delta, rotated back into screen space.
      const deltaWPx = newWPx - startWPx;
      const deltaHPx = newHPx - startHPx;
      const shiftX = (deltaWPx / 2) * Math.cos(theta) - (deltaHPx / 2) * Math.sin(theta);
      const shiftY = (deltaWPx / 2) * Math.sin(theta) + (deltaHPx / 2) * Math.cos(theta);

      const startCxPx = state.rect.cx * state.boxWidth;
      const startCyPx = state.rect.cy * state.boxHeight;

      onChange({
        ...state.rect,
        w: newWPx / state.boxWidth,
        h: newHPx / state.boxHeight,
        cx: (startCxPx + shiftX) / state.boxWidth,
        cy: (startCyPx + shiftY) / state.boxHeight,
      });
      return;
    }

    // rotate: recompute the absolute angle from the badge's center to the
    // pointer every move, so the badge always points straight at it.
    const centerXPx = state.boxLeft + sticker.cx * state.boxWidth;
    const centerYPx = state.boxTop + sticker.cy * state.boxHeight;
    const dx = e.clientX - centerXPx;
    const dy = e.clientY - centerYPx;
    const rotation = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    onChange({ ...sticker, rotation });
  }

  function handlePointerUp() {
    drag.current = null;
  }

  return (
    <div ref={containerRef} className="relative w-full select-none rounded-md bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" draggable={false} className="block w-full rounded-md" />
      {sticker && (
        <div
          onPointerDown={handleMoveStart}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            left: `${(sticker.cx - sticker.w / 2) * 100}%`,
            top: `${(sticker.cy - sticker.h / 2) * 100}%`,
            width: `${sticker.w * 100}%`,
            height: `${sticker.h * 100}%`,
            transform: `rotate(${sticker.rotation}deg)`,
            containerType: "inline-size",
          }}
          className="absolute flex touch-none cursor-move items-center justify-center rounded-sm border-2 border-primary bg-white shadow-md"
        >
          <span
            style={{ fontSize: `${fontSizeCqw}cqw` }}
            className="pointer-events-none select-none whitespace-nowrap font-black leading-none text-black"
          >
            Go<span className="text-primary">Mambo</span>
          </span>
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 touch-none cursor-se-resize rounded-full border-2 border-white bg-primary"
          />
          <div
            onPointerDown={handleRotateStart}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute -top-6 left-1/2 h-4 w-4 -translate-x-1/2 touch-none cursor-grab rounded-full border-2 border-white bg-primary"
          />
        </div>
      )}
    </div>
  );
}
