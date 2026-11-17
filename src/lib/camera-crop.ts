// Maps an on-screen frame-guide element's bounding box to the source
// rectangle in a <video>'s native pixel buffer, accounting for the
// object-cover scaling/clipping applied to fill its container and — for a
// mirrored (CSS scale-x(-1)) preview like a selfie camera — the fact that
// the video's underlying pixel buffer is never actually flipped, only its
// on-screen rendering is.
//
// `pad` widens the rectangle by that fraction of its size on every side, and
// `minShortSide` grows it (same centre, same proportions) until its shorter
// side has at least that many source pixels. Both stop at the edges of the
// video. A selfie needs them: the oval guide is small, so on a 640×480 webcam
// the bare oval was a ~120×160 px file the admin could barely judge.
export function getFrameCropRect(
  video: HTMLVideoElement,
  frameEl: HTMLElement,
  mirrored: boolean,
  { pad = 0, minShortSide = 0 }: { pad?: number; minShortSide?: number } = {}
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
  const frameW = frameRect.width / scale;
  const frameH = frameRect.height / scale;
  if (!frameW || !frameH) return null;

  if (mirrored) {
    sx = vw - sx - frameW;
  }

  let sWidth = frameW * (1 + 2 * pad);
  let sHeight = frameH * (1 + 2 * pad);
  const shortSide = Math.min(sWidth, sHeight);
  if (minShortSide > 0 && shortSide < minShortSide) {
    sWidth *= minShortSide / shortSide;
    sHeight *= minShortSide / shortSide;
  }
  // Never larger than the video itself; shrinking keeps the proportions.
  const fit = Math.min(1, vw / sWidth, vh / sHeight);
  sWidth *= fit;
  sHeight *= fit;

  const centreX = sx + frameW / 2;
  const centreY = sy + frameH / 2;

  return {
    sx: Math.max(0, Math.min(centreX - sWidth / 2, vw - sWidth)),
    sy: Math.max(0, Math.min(centreY - sHeight / 2, vh - sHeight)),
    sWidth,
    sHeight,
  };
}
