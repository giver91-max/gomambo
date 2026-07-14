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

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
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
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
        <img src={previewUrl} alt={label} className="max-h-48 rounded-lg border" />
        <Button type="button" variant="outline" size="sm" onClick={retake}>
          Zrób ponownie
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {isStreaming ? (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-h-64 w-full max-w-xs rounded-lg border"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={takePhoto}>
              Zrób zdjęcie
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={stopCamera}>
              Anuluj
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" onClick={startCamera}>
            {label}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
