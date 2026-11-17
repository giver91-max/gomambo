"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getFrameCropRect } from "@/lib/camera-crop";
import { captureVideoFrame } from "@/lib/verification-image";

const MAX_ATTEMPTS = 3;

export function SelfieCapture({
  onConfirm,
  onSkip,
  cameraHelp,
  isSubmitting = false,
  autoStart = false,
}: {
  onConfirm: (blob: Blob) => void;
  /**
   * Closes the camera after it failed to start. It used to be offered as
   * "Kontynuuj bez selfie — zweryfikujemy ręcznie", but no flow can be sent
   * without a selfie, so that promised a way out that did not exist. Left
   * out, there is no close button (the phone route has nowhere to go back to).
   */
  onSkip?: () => void;
  /** What this particular screen can offer when the camera won't start. */
  cameraHelp?: string;
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
      // Without a size the browser opens the camera at 640×480 and the oval
      // crop came out around 120×160 px. Soft constraints: a weaker camera
      // just gives its best.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setIsStreaming(true);
    } catch {
      const next = attempts + 1;
      setAttempts(next);
      setError(
        next >= MAX_ATTEMPTS
          ? "Nie udało się włączyć kamery. Zezwól tej stronie na dostęp do kamery w ustawieniach przeglądarki i spróbuj ponownie."
          : `Nie udało się włączyć kamery (próba ${next} z ${MAX_ATTEMPTS}). Sprawdź, czy przeglądarka ma zgodę na użycie kamery.`
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

    // The preview is mirrored (CSS scale-x(-1)) for a natural selfie feel,
    // but the video's underlying pixel buffer never actually flips — the
    // crop math has to un-mirror to line up with what's on screen.
    //
    // The crop keeps a small margin around the oval (chin and hair often
    // spill past it) and at least 480 source px on its short side (the whole
    // frame height on a 640×480 webcam): the reviewer has to judge a face,
    // not a thumbnail of one. The margin stays small on purpose — a wider
    // shot pulls people in the background into frame, and a second face
    // fails the selfie check.
    const crop = getFrameCropRect(video, frame, true, { pad: 0.15, minShortSide: 480 });
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
        <img src={previewUrl} alt="Zrobione selfie" className="w-full max-w-sm rounded-2xl border" />
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
          className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            ref={frameRef}
            className="aspect-[3/4] w-[65%] max-w-64 rounded-[50%] border-2 border-white"
            style={{ boxShadow: "0 0 0 2000px rgba(0,0,0,0.55)" }}
          />
        </div>
        <div className="relative z-10 mx-6 mt-4 rounded-xl bg-black/50 px-4 py-2 text-center text-sm text-white">
          Umieść twarz w owalu
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
        Zrób selfie
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {error && cameraHelp && <p className="text-sm text-muted-foreground">{cameraHelp}</p>}
      {/* Offered from the first failure: on a computer without a camera,
          or after a reflexive "Blokuj", every retry fails the same way. */}
      {error && onSkip && (
        <Button type="button" variant="ghost" onClick={onSkip}>
          Zamknij
        </Button>
      )}
    </div>
  );
}
