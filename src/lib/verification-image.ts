/**
 * Identity-verification photos, shaped for what actually reads them.
 *
 * Every photo in this flow ends up in AWS Rekognition, which takes raw bytes
 * only as JPEG or PNG and only up to 5 MB. A raw phone photo breaks that two
 * ways: a HEIC from an iPhone (Chrome on a Mac hands it over as-is), or a
 * 5–8 MB JPEG. Rekognition then threw, the automat could not run, and the
 * admin read "błąd usługi" about what was simply a wrong file — while the
 * person saw no error at all and waited for a review that should have been
 * instant. So the browser re-encodes every photo to a JPEG under the limits
 * before it leaves the device, and the server checks the bytes again (see
 * rekognitionImageProblem) because it can never trust what a client sends.
 *
 * This module has no top-level DOM access, so the server actions can import
 * the byte checks from it too.
 */

/**
 * Longest side of an uploaded photo. 2000 px keeps field 4b of a licence
 * comfortably legible for OCR (documents of ~1000 px have passed every gate
 * in production) while a JPEG of it stays around 0.3–1.5 MB.
 */
export const VERIFICATION_IMAGE_MAX_DIMENSION = 2000;
export const VERIFICATION_JPEG_QUALITY = 0.9;

/** Rekognition's own ceiling for an image passed as Bytes ("5 MB" — read as decimal, the stricter reading). */
export const REKOGNITION_MAX_IMAGE_BYTES = 5 * 1000 * 1000;

// What the browser aims for: under Rekognition's 5 MB, and under Vercel's
// ~4.5 MB request body too, because the phone route posts each photo through
// a server action. At 2000 px a JPEG practically never gets near this; it is
// a guard for pathological images (noise, extreme detail).
const TARGET_MAX_BYTES = 3.5 * 1024 * 1024;

// Decoding a huge file can take the whole tab down on a phone. Nothing a
// camera produces comes close to this.
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export const NOT_AN_IMAGE_MESSAGE = "Plik musi być zdjęciem (JPG lub PNG).";
export const UNREADABLE_IMAGE_MESSAGE =
  "Nie możemy odczytać tego pliku. Wybierz zdjęcie JPG lub PNG — zdjęcie HEIC z iPhone'a zapisz najpierw jako JPG.";
const TOO_LARGE_SOURCE_MESSAGE = "Plik jest za duży. Wybierz zdjęcie mniejsze niż 30 MB.";

/** A photo that cannot be used, with the Polish message to show for it. */
export class VerificationImageError extends Error {}

export type CropRect = { sx: number; sy: number; sWidth: number; sHeight: number };

/** JPEG or PNG by magic bytes — what the file IS, not what its name or type claims. */
export function sniffImageFormat(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) return "png";
  return null;
}

/**
 * Why these bytes cannot be handed to Rekognition, or null when they can.
 * Server-side: the client normally guarantees all of this, but a stale page,
 * an old app version or a hand-made request does not.
 */
export function rekognitionImageProblem(bytes: Uint8Array): "empty" | "format" | "size" | null {
  if (bytes.byteLength === 0) return "empty";
  if (!sniffImageFormat(bytes)) return "format";
  if (bytes.byteLength > REKOGNITION_MAX_IMAGE_BYTES) return "size";
  return null;
}

function fitWithin(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, VERIFICATION_IMAGE_MAX_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  for (const quality of [VERIFICATION_JPEG_QUALITY, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return null;
    if (blob.size <= TARGET_MAX_BYTES || quality === 0.7) return blob;
  }
  return null;
}

/**
 * One frame of a live camera, cropped to `crop` (or whole when null), scaled
 * down to VERIFICATION_IMAGE_MAX_DIMENSION and encoded as JPEG. Crops are
 * taken from the full-resolution video buffer, never from the on-screen
 * preview, so the file is as sharp as the camera allows.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  crop: CropRect | null
): Promise<Blob | null> {
  const src = crop ?? { sx: 0, sy: 0, sWidth: video.videoWidth, sHeight: video.videoHeight };
  if (!src.sWidth || !src.sHeight) return null;
  const { width, height } = fitWithin(src.sWidth, src.sHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, src.sx, src.sy, src.sWidth, src.sHeight, 0, 0, width, height);
  return canvasToJpeg(canvas);
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeImage(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // from-image: a phone photo stored sideways with an EXIF rotation must
      // come out upright, because re-encoding drops the EXIF tag.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through: some Safari versions decode a format through <img>
      // that createImageBitmap refuses.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * A photo picked from disk, turned into a JPEG Rekognition will take: decoded
 * by the browser (so anything it cannot show — HEIC in Chrome, a renamed text
 * file — is refused here with a clear message instead of reaching the admin
 * as an image nobody can open), scaled to at most 2000 px and re-encoded.
 * Re-encoding also strips EXIF, including the GPS position phones embed.
 *
 * @throws VerificationImageError with the message to show.
 */
export async function normaliseVerificationPhoto(file: File, baseName: string): Promise<File> {
  if (file.type === "image/svg+xml" || (file.type !== "" && !file.type.startsWith("image/"))) {
    throw new VerificationImageError(NOT_AN_IMAGE_MESSAGE);
  }
  if (file.size > MAX_SOURCE_BYTES) throw new VerificationImageError(TOO_LARGE_SOURCE_MESSAGE);

  let decoded: Decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new VerificationImageError(UNREADABLE_IMAGE_MESSAGE);
  }

  try {
    if (!decoded.width || !decoded.height) throw new VerificationImageError(UNREADABLE_IMAGE_MESSAGE);
    const { width, height } = fitWithin(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new VerificationImageError(UNREADABLE_IMAGE_MESSAGE);
    // JPEG has no transparency: without a background a transparent PNG
    // turns black, text and all.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas);
    if (!blob) throw new VerificationImageError(UNREADABLE_IMAGE_MESSAGE);
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    decoded.release();
  }
}
