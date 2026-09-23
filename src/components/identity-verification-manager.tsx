"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitIdentityVerification } from "@/app/dashboard/profile/identity-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelfieCapture } from "@/components/selfie-capture";
import { VerificationQrPanel } from "@/components/verification-qr-panel";
import type { IdentityVerificationStatus } from "@/types/database";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

const statusLabel: Record<IdentityVerificationStatus, string> = {
  pending: "Oczekuje na weryfikację",
  approved: "Zweryfikowano",
  rejected: "Odrzucono",
};

const statusVariant: Record<IdentityVerificationStatus, "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

/**
 * Identity verification from a desktop. Collects the same three photos as the
 * phone route — both sides of a driving licence and a live selfie — because
 * the device someone happens to be sitting at shouldn't decide how carefully
 * they get verified.
 *
 * The browser uploads the three photos straight to Supabase Storage and then
 * hands the paths to the server action. That is not the server trusting the
 * client: Vercel caps a request body at ~4.5MB, far below three real phone
 * photos, so posting the files themselves would 413 before any code ran. The
 * action re-downloads what was stored and re-checks all of it — including
 * that the three images are genuinely three different images.
 */
export function IdentityVerificationManager({
  userId,
  initialStatus,
  initialRejectionReason,
  initialDocumentUrl,
  initialDocumentBackUrl,
  initialSelfieUrl,
}: {
  userId: string;
  initialStatus: IdentityVerificationStatus | null;
  initialRejectionReason: string | null;
  initialDocumentUrl: string | null;
  initialDocumentBackUrl: string | null;
  initialSelfieUrl: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [rejectionReason, setRejectionReason] = useState(initialRejectionReason);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  const submitted = Boolean(initialDocumentUrl);

  function pick(side: "front" | "back") {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setError(null);
      if (!file.type.startsWith("image/")) {
        setError("Plik musi być zdjęciem.");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError("Plik przekracza 8 MB.");
        return;
      }
      if (side === "front") setFront(file);
      else setBack(file);
    };
  }

  const ready = Boolean(front && back && selfie && consent);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      try {
        const supabase = createClient();
        const uploaded: Record<"front" | "back" | "selfie", string> = {
          front: "",
          back: "",
          selfie: "",
        };

        for (const [slot, blob] of [
          ["front", front!],
          ["back", back!],
          ["selfie", selfie!],
        ] as const) {
          const path = `${userId}/${crypto.randomUUID()}-${slot}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("id-documents")
            .upload(path, blob, { contentType: blob.type || "image/jpeg" });
          if (uploadError) {
            setError(`Nie udało się wgrać zdjęcia: ${uploadError.message}`);
            return;
          }
          uploaded[slot] = path;
        }

        const result = await submitIdentityVerification(uploaded, consent);
        if (result.error) {
          setError(result.error);
          return;
        }
        setStatus(result.approved ? "approved" : "pending");
        setRejectionReason(null);
        setFront(null);
        setBack(null);
        setSelfie(null);
      } catch (err) {
        // Without this the user sat on "Sprawdzamy…" for ever whenever the
        // request failed before the action could answer.
        setError(
          err instanceof Error ? err.message : "Coś poszło nie tak. Spróbuj ponownie."
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Potrzebujemy zdjęć <strong className="text-foreground">obu stron prawa jazdy</strong> oraz
        selfie zrobionego na żywo. Prawo jazdy, nie dowód osobisty — bez niego nie da się wynająć
        auta. Zdjęcia widzi tylko nasz zespół podczas weryfikacji.
      </p>

      {status && <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>}

      {status === "rejected" && rejectionReason && (
        <p className="text-sm text-destructive">Powód odrzucenia: {rejectionReason}</p>
      )}

      {submitted && (
        <div className="flex flex-wrap gap-3">
          {[
            [initialDocumentUrl, "Prawo jazdy — przód"],
            [initialDocumentBackUrl, "Prawo jazdy — tył"],
            [initialSelfieUrl, "Selfie"],
          ]
            .filter(([url]) => url)
            .map(([url, label]) => (
              <figure key={label as string} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully */}
                <img
                  src={url as string}
                  alt={label as string}
                  className="max-h-40 rounded-lg border object-contain"
                />
                <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
              </figure>
            ))}
        </div>
      )}

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={front ? "secondary" : "outline"}
            size="sm"
            disabled={isPending}
            onClick={() => frontInputRef.current?.click()}
          >
            {front ? "✓ Przód prawa jazdy" : "1. Dodaj przód prawa jazdy"}
          </Button>
          <input
            ref={frontInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={pick("front")}
          />

          <Button
            type="button"
            variant={back ? "secondary" : "outline"}
            size="sm"
            disabled={isPending}
            onClick={() => backInputRef.current?.click()}
          >
            {back ? "✓ Tył prawa jazdy" : "2. Dodaj tył prawa jazdy"}
          </Button>
          <input
            ref={backInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={pick("back")}
          />

          {!capturing && (
            <Button
              type="button"
              variant={selfie ? "secondary" : "outline"}
              size="sm"
              disabled={isPending}
              onClick={() => setCapturing(true)}
            >
              {selfie ? "✓ Selfie" : "3. Zrób selfie"}
            </Button>
          )}
        </div>

        {capturing && (
          <SelfieCapture
            onConfirm={(blob) => {
              setSelfie(blob);
              setCapturing(false);
            }}
            onSkip={() => setCapturing(false)}
            isSubmitting={isPending}
            autoStart
          />
        )}

        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
            disabled={isPending}
          />
          <span>
            Zgadzam się, aby GoMambo porównał moje selfie ze zdjęciem w prawie jazdy w celu
            potwierdzenia tożsamości.
          </span>
        </label>

        <Button type="button" size="sm" disabled={!ready || isPending} onClick={submit}>
          {isPending ? "Sprawdzamy…" : "Wyślij do weryfikacji"}
        </Button>

        {!ready && !isPending && (
          <p className="text-xs text-muted-foreground">
            Potrzebne są wszystkie trzy zdjęcia i zgoda.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!capturing && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            Wolisz zrobić zdjęcia telefonem? Zeskanuj kod QR — aparat telefonu robi wyraźniejsze
            zdjęcia dokumentu niż kamerka w laptopie.
          </p>
          <VerificationQrPanel />
        </div>
      )}
    </div>
  );
}
