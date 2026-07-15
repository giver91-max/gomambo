// Maps an on-screen frame-guide element's bounding box to the source
// rectangle in a <video>'s native pixel buffer, accounting for the
// object-cover scaling/clipping applied to fill its container and — for a
// mirrored (CSS scale-x(-1)) preview like a selfie camera — the fact that
// the video's underlying pixel buffer is never actually flipped, only its
// on-screen rendering is.
export function getFrameCropRect(
  video: HTMLVideoElement,
  frameEl: HTMLElement,
  mirrored: boolean
): { sx: number; sy: number; sWidth: number; sHeight: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  // The video element is positioned `inset-0` over its full-screen
  // container, so its own rect *is* the object-cover container rect.
  const containerRect = video.getBoundingClientRect();
  const frameRect = frameEl.getBoundingClientRect();
  const cw = containerRect.width;
  const ch = containerRect.height;
  if (!cw || !ch) return null;

  const scale = Math.max(cw / vw, ch / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offsetX = (dispW - cw) / 2;
  const offsetY = (dispH - ch) / 2;

  const relLeft = frameRect.left - containerRect.left;
  const relTop = frameRect.top - containerRect.top;

  let sx = (relLeft + offsetX) / scale;
  const sy = (relTop + offsetY) / scale;
  const sWidth = frameRect.width / scale;
  const sHeight = frameRect.height / scale;

  if (mirrored) {
    sx = vw - sx - sWidth;
  }

  return {
    sx: Math.max(0, Math.min(sx, vw - sWidth)),
    sy: Math.max(0, Math.min(sy, vh - sHeight)),
    sWidth: Math.min(sWidth, vw),
    sHeight: Math.min(sHeight, vh),
  };
}
