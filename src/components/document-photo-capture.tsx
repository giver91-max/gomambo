"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getFrameCropRect } from "@/lib/camera-crop";
import { captureVideoFrame } from "@/lib/verification-image";

const MAX_ATTEMPTS = 3;

// Generalizes selfie-capture.tsx's getUserMedia+canvas pattern for photos
// of a physical document. Uses the rear camera (facingMode: "environment")
// and has no skip affordance — the verification cannot be completed without
// both sides of the licence. Capture and upload are separate
// steps: taking a photo only shows a preview, the caller's onConfirm only
// fires once the user explicitly taps "Dalej", so retaking never involves
// a wasted upload.
export function DocumentPhotoCapture({
  label,
  onConfirm,
  isSubmitting = false,
  autoStart = false,
}: {
  label: string;
  onConfirm: (blob: Blob) => void;
  isSubmitting?: boolean;
  autoStart?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // The <video> element only mounts once isStreaming flips to true, so it
  // doesn't exist yet at the point startCamera() resolves — srcObject has
  // to be attached here, after the element has actually committed to the DOM.
  useEffect(() => {
    if (isStreaming && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isStreaming]);

  async function startCamera() {
    setError(null);
    try {
      // Without a size the browser opens the camera at 640×480, and the
      // licence cropped out of that frame came out around 250×155 px — too
      // small for anyone, human or OCR, to read the name or field 4b. These
      // are soft ("ideal") constraints: a camera that cannot do it simply
      // gives its best instead of failing. Portrait phones rotate the stream
      // themselves, so the landscape numbers are right there too. 4K, not
      // 1440p: iOS Safari only has 1080p and 4K presets and rounds 1440p down
      // to 1080p, leaving the licence crop at ~740 px instead of ~1480 px.
      // File size is not the cost it looks like — captureVideoFrame scales
      // every photo to at most 2000 px before encoding.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      streamRef.current = stream;
      setIsStreaming(true);
    } catch {
      const next = attempts + 1;
      setAttempts(next);
      setError(
        next >= MAX_ATTEMPTS
          ? "Nie udało się włączyć aparatu. Zezwól tej stronie na dostęp do kamery w ustawieniach przeglądarki, odśwież stronę i spróbuj ponownie."
          : `Nie udało się włączyć aparatu (próba ${next} z ${MAX_ATTEMPTS}). Sprawdź, czy przeglądarka ma zgodę na użycie kamery.`
      );
    }
  }

  // Auto-continue straight into the next capture instead of making the
  // user tap "start camera" again right after finishing the previous shot.
  useEffect(() => {
    if (autoStart) startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsStreaming(false);
  }

  async function takePhoto() {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;

    // Only the area inside the guide frame is kept — not the full,
    // uncropped camera view — so the uploaded photo matches what the user
    // actually lined up. The crop comes from the full-resolution video
    // buffer and is encoded as a JPEG within Rekognition's limits.
    const crop = getFrameCropRect(video, frame, false);
    const blob = await captureVideoFrame(video, crop);
    if (!blob) return;
    capturedBlobRef.current = blob;
    setPreviewUrl(URL.createObjectURL(blob));
    stopCamera();
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    capturedBlobRef.current = null;
    startCamera();
  }

  function confirm() {
    if (capturedBlobRef.current) onConfirm(capturedBlobRef.current);
  }

  if (previewUrl) {
    return (
      <div className="flex w-full flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
        <img src={previewUrl} alt={label} className="w-full max-w-sm rounded-2xl border" />
        <div className="flex w-full max-w-sm gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={retake}
            disabled={isSubmitting}
          >
            Zrób ponownie
          </Button>
          <Button type="button" size="lg" className="flex-1" onClick={confirm} disabled={isSubmitting}>
            {isSubmitting ? "Przesyłanie…" : "Dalej"}
          </Button>
        </div>
      </div>
    );
  }

  if (isStreaming) {
    return (
      // z-[60]: above the cookie banner (z-50, rendered after the page in the
      // root layout), which would otherwise cover the shutter and "Anuluj" —
      // on a phone that has never been on GoMambo it is always there.
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-black py-6">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
          <div
            ref={frameRef}
            className="aspect-[1.586/1] w-full max-w-sm rounded-2xl border-2 border-white"
            style={{ boxShadow: "0 0 0 2000px rgba(0,0,0,0.55)" }}
          />
        </div>
        <div className="relative z-10 mx-6 mt-4 rounded-xl bg-black/50 px-4 py-2 text-center text-sm text-white">
          Wyrównaj dokument w ramce
        </div>
        <div className="relative z-10 flex items-center gap-6 pb-4">
          <Button type="button" variant="secondary" size="lg" onClick={stopCamera}>
            Anuluj
          </Button>
          <button
            type="button"
            onClick={takePhoto}
            aria-label="Zrób zdjęcie"
            className="size-18 rounded-full border-4 border-white bg-white/20 active:bg-white/40"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Button type="button" size="lg" className="w-full max-w-xs" onClick={startCamera}>
        {label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
