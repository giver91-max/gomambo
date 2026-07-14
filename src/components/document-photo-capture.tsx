"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const MAX_ATTEMPTS = 3;

// Generalizes selfie-capture.tsx's getUserMedia+canvas pattern for photos
// of a physical document. Uses the rear camera (facingMode: "environment")
// and, unlike a selfie, has no skip affordance — a license photo can't be
// omitted the way an optional selfie can.
export function DocumentPhotoCapture({
  label,
  onCapture,
}: {
  label: string;
  onCapture: (blob: Blob) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setIsStreaming(true);
    } catch {
      const next = attempts + 1;
      setAttempts(next);
      setError(
        next >= MAX_ATTEMPTS
          ? "Nie udało się uzyskać dostępu do kamery. Odśwież stronę i spróbuj ponownie."
          : `Nie udało się uzyskać dostępu do kamery (próba ${next} z ${MAX_ATTEMPTS}).`
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsStreaming(false);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPreviewUrl(URL.createObjectURL(blob));
        stopCamera();
        onCapture(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    startCamera();
  }

  if (previewUrl) {
    return (
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
        <img src={previewUrl} alt={label} className="w-full max-w-sm rounded-2xl border" />
        <Button type="button" variant="outline" size="lg" onClick={retake}>
          Zrób ponownie
        </Button>
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black py-6">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="relative z-10 mx-6 mt-4 rounded-xl bg-black/50 px-4 py-2 text-center text-sm text-white">
          {label}
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
