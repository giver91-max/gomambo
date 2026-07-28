// Car photos come straight off phone cameras (often 3-5MB, 4000px+ wide).
// Storage on the free Supabase plan is capped at 1GB total, so uploading
// them uncompressed caps the platform at a few dozen cars. Downscaling to a
// resolution that still looks sharp in the UI (nothing here renders photos
// wider than ~1000px) cuts typical uploads to a few hundred KB.
export const MAX_IMAGE_DIMENSION = 1920;
export const IMAGE_JPEG_QUALITY = 0.82;

export function computeResizedDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function resizeImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = computeResizedDimensions(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", IMAGE_JPEG_QUALITY)
  );
  // Guard against already-optimized/tiny source images where re-encoding
  // would make the file bigger — keep the original in that case.
  if (!blob || blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}
