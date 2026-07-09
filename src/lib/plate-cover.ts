export type StickerRect = { x: number; y: number; w: number; h: number };

export const DEFAULT_STICKER: StickerRect = { x: 0.34, y: 0.64, w: 0.32, h: 0.32 / 3.4 };

const PRIMARY = "#f5c518";
const INK = "#111111";

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

  const x = rect.x * canvas.width;
  const y = rect.y * canvas.height;
  const w = rect.w * canvas.width;
  const h = rect.h * canvas.height;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = Math.max(2, h * 0.05);
  ctx.strokeStyle = INK;
  ctx.strokeRect(x, y, w, h);

  const fontSize = Math.round(h * 0.5);
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "middle";
  const goText = "Go";
  const amboText = "Mambo";
  const goWidth = ctx.measureText(goText).width;
  const amboWidth = ctx.measureText(amboText).width;
  let textX = x + (w - goWidth - amboWidth) / 2;
  const textY = y + h / 2 + h * 0.02;

  ctx.fillStyle = INK;
  ctx.fillText(goText, textX, textY);
  textX += goWidth;
  ctx.fillStyle = PRIMARY;
  ctx.fillText(amboText, textX, textY);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
  );
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}
