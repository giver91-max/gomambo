"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitIdentityVerification } from "@/app/dashboard/profile/identity-actions";
import { cancelDocumentReplacement } from "@/app/dashboard/profile/verification-handoff-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelfieCapture } from "@/components/selfie-capture";
import { VerificationQrPanel, useCoarsePointer } from "@/components/verification-qr-panel";
import type { IdentityVerificationStatus } from "@/types/database";
import { BIOMETRIC_CONSENT_TEXT } from "@/lib/terms";
import {
  UNREADABLE_IMAGE_MESSAGE,
  VerificationImageError,
  normaliseVerificationPhoto,
} from "@/lib/verification-image";

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

// Shown when a request never got an answer (the connection dropped, or the
// page predates a deploy). The browser's own text — "Load failed", "Failed to
// fetch" — said nothing a person could act on.
const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

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
  verificationUpdatedAt = null,
}: {
  userId: string;
  initialStatus: IdentityVerificationStatus | null;
  initialRejectionReason: string | null;
  initialDocumentUrl: string | null;
  initialDocumentBackUrl: string | null;
  initialSelfieUrl: string | null;
  /** Changes whenever the saved verification does — including a resubmission that kept the same status. */
  verificationUpdatedAt?: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [rejectionReason, setRejectionReason] = useState(initialRejectionReason);
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [preparing, setPreparing] = useState<"front" | "back" | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [consent, setConsent] = useState(false);
  // An approved account replacing its documents, after saying so explicitly.
  const [replacing, setReplacing] = useState(false);
  const [cancellingReplace, setCancellingReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Just sent and waiting for a human. The form empties itself for a possible
  // resend, and the badge that changes sits far above, off a phone's screen —
  // without a word by the button the sending looked like it had failed.
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const isTouch = useCoarsePointer();

  // The status arrives as a prop, but finishing on the phone only refreshes
  // the page (router.refresh), which keeps this component's state — so the
  // badge stayed missing, or kept saying "Odrzucono" with the old reason,
  // after a successful verification. Follow the server whenever the saved
  // verification changes; a finished replacement also ends "replacing".
  useEffect(() => {
    setStatus(initialStatus);
    setRejectionReason(initialRejectionReason);
    setReplacing(false);
  }, [initialStatus, initialRejectionReason, verificationUpdatedAt]);

  const submitted = Boolean(initialDocumentUrl);

  function pick(side: "front" | "back") {
    return async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setError(null);
      setPreparing(side);
      try {
        // Re-encoded to a JPEG Rekognition can take before anything is
        // uploaded — see lib/verification-image.ts. A file the browser
        // cannot decode (HEIC in Chrome) is refused here, with the fix.
        const photo = await normaliseVerificationPhoto(file, side);
        if (side === "front") setFront(photo);
        else setBack(photo);
      } catch (err) {
        setError(err instanceof VerificationImageError ? err.message : UNREADABLE_IMAGE_MESSAGE);
      } finally {
        setPreparing(null);
      }
    };
  }

  const ready = Boolean(front && back && selfie && consent);
  const busy = isPending || preparing !== null;

  function startReplacing() {
    if (
      confirm(
        "Wymienić zweryfikowany dokument? Nowe zdjęcia zastąpią obecne. Jeśli automat ich nie potwierdzi, weryfikacja wróci do sprawdzenia przez administratora i do tego czasu nie będzie można dodawać aut ani rezerwować."
      )
    ) {
      setError(null);
      setReplacing(true);
    }
  }

  // The phone session opened for the replacement lives on the server, so the
  // cancel has to reach it there (cancelDocumentReplacement); hiding the panel
  // alone left it able to replace the approved document later.
  async function cancelReplacing() {
    setError(null);
    setCancellingReplace(true);
    try {
      await cancelDocumentReplacement();
      setReplacing(false);
    } catch (err) {
      console.error("[identity] could not cancel the replacement", err);
      setError(CONNECTION_FAILED);
    } finally {
      setCancellingReplace(false);
    }
  }

  function submit() {
    if (!ready) return;
    setError(null);
    setSent(false);
    startTransition(async () => {
      const supabase = createClient();
      const uploadedPaths: string[] = [];
      let actionStarted = false;
      // Identity photos nobody will ever look at must not stay in storage.
      // Safe only while the server has not saved them: before the action
      // runs, or when it answered with a refusal.
      const discardUploads = async () => {
        if (uploadedPaths.length === 0) return;
        try {
          await supabase.storage.from("id-documents").remove(uploadedPaths);
        } catch {
          // Best effort: the message about what went wrong matters more.
        }
      };

      try {
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
            .upload(path, blob, { contentType: "image/jpeg" });
          if (uploadError) {
            await discardUploads();
            setError("Nie udało się wgrać zdjęcia. Sprawdź połączenie i spróbuj ponownie.");
            return;
          }
          uploadedPaths.push(path);
          uploaded[slot] = path;
        }

        actionStarted = true;
        const result = await submitIdentityVerification(uploaded, consent, {
          replaceApproved: replacing,
        });
        if (result.error) {
          await discardUploads();
          setError(result.error);
          return;
        }
        setStatus(result.approved ? "approved" : "pending");
        setSent(!result.approved);
        setRejectionReason(null);
        setReplacing(false);
        setFront(null);
        setBack(null);
        setSelfie(null);
      } catch (err) {
        // If the action may have run, its answer was lost but the photos may
        // already be the saved verification — leave them alone.
        if (!actionStarted) await discardUploads();
        console.error("[identity] verification submit failed", err);
        // Without this the user sat on "Sprawdzamy…" for ever whenever the
        // request failed before the action could answer. Once the action was
        // called, nobody can tell from here whether it saved the photos.
        setError(
          actionStarted
            ? "Nie dostaliśmy odpowiedzi z GoMambo — zdjęcia mogły już dotrzeć. Odśwież stronę, żeby sprawdzić status weryfikacji, zanim wyślesz je ponownie."
            : CONNECTION_FAILED
        );
      }
    });
  }

  const showForm = status !== "approved" || replacing;

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

      {/* An approved verification is done. The upload form stays one explicit,
          confirmed click away ("Zmień dokument" — e.g. a new licence) instead
          of sitting under the badge, where sending it again silently dropped
          the account back to pending. */}
      {!showForm && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm">Tożsamość zweryfikowana ✓ Możesz dodawać auta i rezerwować.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/cars/new" className={buttonVariants({ size: "sm" })}>
              Dodaj auto →
            </Link>
            <Button type="button" variant="ghost" size="sm" onClick={startReplacing}>
              Zmień dokument (np. nowe prawo jazdy)
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <>
          {replacing && (
            <div className="space-y-2 rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
              <p>
                Wymieniasz zweryfikowany dokument. Jeśli automat nie potwierdzi nowych zdjęć,
                weryfikacja wróci do sprawdzenia przez administratora.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending || cancellingReplace}
                onClick={cancelReplacing}
              >
                {cancellingReplace ? "Anulowanie…" : "Anuluj wymianę"}
              </Button>
            </div>
          )}

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={front ? "secondary" : "outline"}
                size="sm"
                disabled={busy}
                onClick={() => frontInputRef.current?.click()}
              >
                {preparing === "front"
                  ? "Przygotowuję zdjęcie…"
                  : front
                    ? "✓ Przód prawa jazdy"
                    : "1. Dodaj przód prawa jazdy"}
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
                disabled={busy}
                onClick={() => backInputRef.current?.click()}
              >
                {preparing === "back"
                  ? "Przygotowuję zdjęcie…"
                  : back
                    ? "✓ Tył prawa jazdy"
                    : "2. Dodaj tył prawa jazdy"}
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
                  disabled={busy}
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
                cameraHelp={
                  isTouch
                    ? "Zezwól tej stronie na dostęp do aparatu (ustawienia przeglądarki albo ikona przy adresie strony) i spróbuj ponownie."
                    : "Na komputerze bez kamerki dokończ weryfikację telefonem — kod QR jest poniżej."
                }
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
                {BIOMETRIC_CONSENT_TEXT}{" "}
                <a href="/polityka-prywatnosci" target="_blank" className="underline">
                  Polityka prywatności
                </a>
              </span>
            </label>

            <Button type="button" size="sm" disabled={!ready || busy} onClick={submit}>
              {isPending ? "Sprawdzamy…" : "Wyślij do weryfikacji"}
            </Button>

            {sent && status === "pending" && (
              <p className="text-sm text-primary">
                Wysłane ✓ Sprawdzimy zdjęcia, zwykle w ciągu 24 godzin, i damy znać mailem.
              </p>
            )}

            {/* Right after sending the empty form needs no explaining; the
                hint comes back once new photos are being added. */}
            {!ready && !isPending && !(sent && !front && !back && !selfie) && (
              <p className="text-xs text-muted-foreground">
                Potrzebne są wszystkie trzy zdjęcia i zgoda.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Rendered while the selfie camera is open too: the camera is a
              full-screen overlay, and when it fails this is the way forward —
              hiding it (and unmounting a QR session already in progress) left
              a computer without a camera with no visible route at all. */}
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              {isTouch
                ? "Wolisz zdjęcia krok po kroku, z ramką do wyrównania dokumentu? Otwórz weryfikację w aparacie tego telefonu."
                : "Wolisz zrobić zdjęcia telefonem? Zeskanuj kod QR — aparat telefonu robi wyraźniejsze zdjęcia dokumentu niż kamerka w laptopie."}
            </p>
            <VerificationQrPanel replaceApproved={replacing} />
          </div>
        </>
      )}
    </div>
  );
}
