// Car photos come straight off phone cameras (often 3-10MB, 4000px+ wide).
// Storage on the free Supabase plan is capped at 1GB total, so uploading
// them uncompressed caps the platform at a few dozen cars. Downscaling to a
// resolution that still looks sharp in the UI (nothing here renders photos
// wider than ~1000px) cuts typical uploads to a few hundred KB.
export const MAX_IMAGE_DIMENSION = 1920;
export const IMAGE_JPEG_QUALITY = 0.82;

// The original is only ever decoded, never uploaded, so its size is not what
// Storage pays for: a 24 MP iPhone JPEG or a 50 MP Android shot runs 5-15MB
// and becomes a few hundred KB here. The cap only keeps a phone from running
// out of memory on something absurd.
export const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_SOURCE_IMAGE_MB = MAX_SOURCE_IMAGE_BYTES / (1024 * 1024);
// Checked on the downscaled JPEG, the file that is actually uploaded. A
// 1920 px JPEG is far below it; this only catches something unexpected.
export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

// Formats every browser can show as they are. Anything else (HEIC above all)
// is always re-encoded, or the listing would be blank for most renters.
const WEB_SAFE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function computeResizedDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** iPhone photos. Chrome on Windows reports no type for them, hence the name. */
export function isHeicFile(file: File): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || isHeicFile(file);
}

/** "jpg", "pdf"… from the file name, or `fallback` when the name has none usable. */
export function fileExtension(file: File, fallback = "jpg"): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(file.name);
  return match ? match[1].toLowerCase() : fallback;
}

export type DecodedImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Frees the decoded pixels — a 24 MP photo holds ~100MB until then. */
  release: () => void;
};

/**
 * Decode a photo so it can be drawn on a canvas, or throw when this browser
 * cannot read it. createImageBitmap first; some browsers open a format in an
 * <img> that createImageBitmap refuses (HEIC in Safari, depending on the
 * version), so that is tried before giving up. Chrome, Edge and Firefox
 * cannot decode HEIC at all — the caller tells the person how to send a JPG.
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error("Image has no size");
      return {
        image: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }
}

/** Why a photo cannot be used, in words the person can act on. */
export function unreadablePhotoMessage(file: File): string {
  return isHeicFile(file)
    ? `„${file.name}” to zdjęcie HEIC z iPhone'a — ta przeglądarka go nie otworzy. Dodaj je prosto z iPhone'a (zapisze się jako JPG) albo zapisz je najpierw jako JPG (na Macu: Podgląd → Plik → Eksportuj → JPEG).`
    : `Nie możemy otworzyć zdjęcia „${file.name}” — może być uszkodzone albo w nietypowym formacie. Wybierz zdjęcie JPG lub PNG.`;
}

/**
 * Whether a selected car photo can be used: an image, within the sanity cap,
 * and decodable by this browser. Run when photos are picked, so a HEIC file
 * in Chrome is refused on the spot instead of failing after the form is sent.
 * Returns the message to show, or null when the photo is fine.
 */
export async function checkPhotoFile(file: File): Promise<string | null> {
  if (!isImageFile(file)) return `Plik „${file.name}” nie jest zdjęciem.`;
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    return `Zdjęcie „${file.name}” ma ponad ${MAX_SOURCE_IMAGE_MB} MB — wybierz mniejsze.`;
  }
  try {
    (await decodeImage(file)).release();
    return null;
  } catch {
    return unreadablePhotoMessage(file);
  }
}

export async function resizeImageForUpload(file: File): Promise<File> {
  if ((!file.type.startsWith("image/") && !isHeicFile(file)) || file.type === "image/svg+xml") {
    return file;
  }
  const webSafe = WEB_SAFE_TYPES.has(file.type);

  const decoded = await decodeImage(file);
  try {
    const { width, height } = computeResizedDimensions(decoded.width, decoded.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (webSafe) return file;
      throw new Error("Canvas 2D context unavailable");
    }

    ctx.drawImage(decoded.image, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", IMAGE_JPEG_QUALITY)
    );
    if (!blob) {
      if (webSafe) return file;
      throw new Error("Canvas could not encode a JPEG");
    }
    // Guard against already-optimized/tiny source images where re-encoding
    // would make the file bigger — keep the original in that case, but only
    // one every browser can show.
    if (webSafe && blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } finally {
    decoded.release();
  }
}

/**
 * A policy scan or photo as it will be uploaded. A PDF goes as it is. A
 * photo goes as taken unless it is bigger than `maxBytes` or in a format
 * other browsers cannot show (HEIC) — then it is re-encoded as a JPEG of at
 * most 1920 px, which still reads well for an A4 page. A phone photo of the
 * policy used to be refused for being over the limit; now it is shrunk.
 */
export async function prepareDocumentFile(
  file: File,
  maxBytes: number
): Promise<{ file: File; error?: undefined } | { file?: undefined; error: string }> {
  const maxMb = Math.round(maxBytes / (1024 * 1024));
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    return file.size > maxBytes ? { error: `Plik „${file.name}” przekracza ${maxMb} MB.` } : { file };
  }
  if (!isImageFile(file)) return { error: "Polisa musi być zdjęciem albo PDF-em." };
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    return { error: `Zdjęcie „${file.name}” ma ponad ${MAX_SOURCE_IMAGE_MB} MB — wybierz mniejsze.` };
  }
  if (!isHeicFile(file) && file.size <= maxBytes) return { file };
  try {
    const resized = await resizeImageForUpload(file);
    return resized.size > maxBytes
      ? { error: `Zdjęcie „${file.name}” jest za duże nawet po zmniejszeniu — wybierz inne.` }
      : { file: resized };
  } catch {
    return { error: unreadablePhotoMessage(file) };
  }
}
