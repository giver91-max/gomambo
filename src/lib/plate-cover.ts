// Center-based (not top-left) so rotating around the badge's own center
// doesn't require also shifting its position.
export type StickerRect = { cx: number; cy: number; w: number; h: number; rotation: number };

export const DEFAULT_STICKER: StickerRect = {
  cx: 0.5,
  cy: 0.7,
  w: 0.36,
  h: 0.36 / 2.6,
  rotation: 0,
};

const PRIMARY = "#f5c518";
const INK = "#111111";
const FONT = `system-ui, -apple-system, sans-serif`;
const TEXT_FILL_RATIO = 0.9;

let measureCanvas: HTMLCanvasElement | null = null;

function measureTextWidthAtSize(text: string, fontSizePx: number): number {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d")!;
  ctx.font = `900 ${fontSizePx}px ${FONT}`;
  return ctx.measureText(text).width;
}

// Width of "GoMambo" per 1px of font-size — text metrics scale linearly
// with font-size, so this lets us solve directly for the font-size that
// makes the text fill a given target width instead of guessing a ratio.
function unitTextWidth(): number {
  const seed = 100;
  return (measureTextWidthAtSize("Go", seed) + measureTextWidthAtSize("Mambo", seed)) / seed;
}

// Font-size, in CSS container-query width units (1cqw = 1% of the badge's
// own width), that makes "GoMambo" fill TEXT_FILL_RATIO of the badge — the
// live preview uses this (with container queries handling the actual
// responsive scaling) so it tracks the same target used when flattening.
export function getBadgeFontSizeCqw(): number {
  return (TEXT_FILL_RATIO * 100) / unitTextWidth();
}

// Bakes the GoMambo badge into the actual image pixels (not just a DOM
// overlay) so the covered plate never leaves the browser in the uploaded
// file.
export async function flattenImageWithSticker(
  file: File,
  rect: StickerRect | null
): Promise<File> {
  if (!rect) return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0);

  const cx = rect.cx * canvas.width;
  const cy = rect.cy * canvas.height;
  const w = rect.w * canvas.width;
  const h = rect.h * canvas.height;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rect.rotation * Math.PI) / 180);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = Math.max(2, h * 0.05);
  ctx.strokeStyle = INK;
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  const targetTextWidth = w * TEXT_FILL_RATIO;
  const fontSize = Math.min(targetTextWidth / unitTextWidth(), h * 0.85);
  ctx.font = `900 ${fontSize}px ${FONT}`;
  ctx.textBaseline = "middle";
  const goText = "Go";
  const amboText = "Mambo";
  const goWidth = ctx.measureText(goText).width;
  const amboWidth = ctx.measureText(amboText).width;
  let textX = -(goWidth + amboWidth) / 2;
  const textY = h * 0.02;

  ctx.fillStyle = INK;
  ctx.fillText(goText, textX, textY);
  textX += goWidth;
  ctx.fillStyle = PRIMARY;
  ctx.fillText(amboText, textX, textY);

  ctx.restore();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
  );
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}
