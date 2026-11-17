"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentPhotoCapture } from "@/components/document-photo-capture";
import { SelfieCapture } from "@/components/selfie-capture";
import {
  claimHandoff,
  finalizeHandoff,
  retrySelfieVerification,
  sendHandoffCode,
  uploadHandoffPhoto,
} from "./actions";
import type {
  FaceMatchResult,
  HandoffStatus,
  IdentityVerificationStatus,
} from "@/types/database";
import { BIOMETRIC_CONSENT_TEXT } from "@/lib/terms";
import { VERIFICATION_PATH } from "@/lib/links";

type Step =
  | "send_code"
  | "enter_code"
  | "consent"
  | "front"
  | "back"
  | "selfie"
  | "finalizing"
  | "review_needed"
  | "loading_result"
  | "done";

function stepFromStatus(status: HandoffStatus): Step {
  if (status === "pending") return "send_code";
  if (status === "code_sent") return "enter_code";
  if (status === "claimed" || status === "photos_uploaded") return "consent";
  // A finished session (iOS reloads the tab after switching apps) asks the
  // server what was decided before saying anything — see the effect below.
  if (status === "completed") return "loading_result";
  return "done";
}

// Only for a request that never got an answer — a phone on mobile data drops
// out mid-upload, or the page predates a deploy. The browser's own text
// ("Load failed", "Failed to fetch") is logged, not shown: it said nothing
// about what to do. Refusals the actions return keep their own wording.
function toErrorMessage(err: unknown): string {
  console.error("[verify-handoff] request failed", err);
  return "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";
}

// The way on from a finished session. It may have been opened from a QR code
// on a computer or straight on this phone ("Otwórz na tym telefonie"), so the
// screens no longer send everyone back to "the device with the QR code".
function ContinueLink({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className={buttonVariants({ size: "lg", className: "w-full" })}>
      Przejdź do GoMambo →
    </Link>
  );
}

function IndeterminateProgressBar() {
  return (
    <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
      <div className="h-full w-1/3 animate-indeterminate-progress rounded-full bg-primary" />
    </div>
  );
}

export function HandoffPhoneFlow({
  token,
  initialStatus,
  maskedEmail,
  savedPhotos,
}: {
  token: string;
  initialStatus: HandoffStatus;
  maskedEmail: string;
  /** Which photos the session already holds when the page loads. */
  savedPhotos: { front: boolean; back: boolean; selfie: boolean };
}) {
  const [step, setStep] = useState<Step>(stepFromStatus(initialStatus));
  // Where the steps pick up after the consent screen. A reload — the camera
  // help says to refresh, iOS reloads the tab after switching apps — used to
  // restart at the front of the licence although both sides were already on
  // the server. Only the page's first load can be part-way through: a code
  // confirmed on this page starts a session with no photos yet. Straight to
  // the result only once the server has marked the photos complete; short of
  // that, retaking the selfie is what records it.
  const resumeAt: "front" | "back" | "selfie" | "finalize" = !savedPhotos.front
    ? "front"
    : !savedPhotos.back
      ? "back"
      : !savedPhotos.selfie || initialStatus !== "photos_uploaded"
        ? "selfie"
        : "finalize";
  const [consentGiven, setConsentGiven] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  // The session is over (expired, closed by a newer one): "Spróbuj ponownie"
  // would only fail again, so it is not offered.
  const [finalizeTerminal, setFinalizeTerminal] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<IdentityVerificationStatus | null>(
    null
  );
  const [retryError, setRetryError] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<FaceMatchResult | null>(null);
  // Whether the server actually approved the verification, not whether the
  // photos looked alike. These are different answers and the screen must not
  // guess: telling someone "potwierdzone" while the desktop still says
  // "czeka na weryfikację" is the bug this flag exists to prevent.
  const [approved, setApproved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Reload of a finished session: finalizeHandoff returns the stored outcome
  // without re-running anything. Without this the page said "sprawdzi je
  // jeszcze człowiek" to someone the automat had already approved.
  useEffect(() => {
    if (initialStatus !== "completed") return;
    let cancelled = false;
    finalizeHandoff(token)
      .then((result) => {
        if (cancelled) return;
        // Every refusal is shown as it is, never the generic "Zdjęcia
        // przesłane ✓", which promises a human review of photos that may
        // never have been saved. Reloaded while the finalize that was running
        // is still saving (iOS reloads a tab after switching apps), the retry
        // will read the result; a terminal answer — a claim recovered into a
        // session that has expired or been closed since — leads to the profile.
        if (result.error) {
          setFinalizeError(result.error);
          setFinalizeTerminal(result.terminal ?? false);
          setStep("finalizing");
          return;
        }
        setFinalResult(result.result ?? null);
        setApproved(result.approved ?? false);
        setVerificationStatus(result.status ?? null);
        setStep("done");
      })
      .catch((err) => {
        if (cancelled) return;
        // No answer at all: the retry asks again. That is safe on a finished
        // session — finalizeHandoff only reads it, or recovers a claim a
        // failed finalize left behind.
        setFinalizeError(toErrorMessage(err));
        setStep("finalizing");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the status the page loaded with
  }, []);

  function handleSendCode() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendHandoffCode(token);
        if (result.error) {
          setError(result.error);
          return;
        }
        setStep("enter_code");
      } catch (err) {
        setError(toErrorMessage(err));
      }
    });
  }

  function handleClaim() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await claimHandoff(token, code);
        if (result.error) {
          setError(result.error);
          return;
        }
        setStep("consent");
      } catch (err) {
        setError(toErrorMessage(err));
      }
    });
  }

  function uploadDocumentPhoto(kind: "front" | "back", blob: Blob, nextStep: Step) {
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", blob, `${kind}.jpg`);
        const result = await uploadHandoffPhoto(token, kind, consentGiven, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
        setStep(nextStep);
      } catch (err) {
        setError(toErrorMessage(err));
      }
    });
  }

  function runFinalize() {
    setFinalizeError(null);
    setFinalizeTerminal(false);
    startTransition(async () => {
      try {
        const result = await finalizeHandoff(token);
        if (result.error) {
          setFinalizeError(result.error);
          setFinalizeTerminal(result.terminal ?? false);
          return;
        }
        setFinalResult(result.result ?? null);
        setApproved(result.approved ?? false);
        setVerificationStatus(result.status ?? null);
        // Offer a retake only when retaking could plausibly change the
        // outcome — i.e. the faces didn't match. If they matched but the
        // automatic approval didn't fire (score just under the bar, or the
        // expiry date unreadable), another selfie won't fix it and a human
        // is already looking.
        setStep(result.approved || result.result === "match" ? "done" : "review_needed");
      } catch (err) {
        setFinalizeError(toErrorMessage(err));
      }
    });
  }

  function uploadSelfieThenFinalize(blob: Blob) {
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", blob, "selfie.jpg");
        const result = await uploadHandoffPhoto(token, "selfie", consentGiven, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
      } catch (err) {
        setError(toErrorMessage(err));
        return;
      }
      setStep("finalizing");
      runFinalize();
    });
  }

  function retrySelfie() {
    setRetryError(null);
    startTransition(async () => {
      try {
        const result = await retrySelfieVerification(token);
        if (result.error) {
          setRetryError(result.error);
          return;
        }
        setStep("selfie");
      } catch (err) {
        setRetryError(toErrorMessage(err));
      }
    });
  }

  if (step === "send_code") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Weryfikacja tożsamości</h1>
        <p className="text-base text-muted-foreground">
          Wyślemy jednorazowy kod na Twój adres e-mail: <strong>{maskedEmail}</strong>
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" size="lg" className="w-full" disabled={isPending} onClick={handleSendCode}>
          {isPending ? "Wysyłanie…" : "Wyślij kod e-mail"}
        </Button>
      </div>
    );
  }

  if (step === "enter_code") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Wpisz kod z e-maila</h1>
        <p className="text-base text-muted-foreground">
          Kod wysłaliśmy na <strong>{maskedEmail}</strong>.
        </p>
        <Input
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="h-14 text-center text-2xl tracking-[0.3em]"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={isPending || code.length !== 6}
          onClick={handleClaim}
        >
          {isPending ? "Sprawdzanie…" : "Potwierdź"}
        </Button>
        <Button type="button" variant="ghost" disabled={isPending} onClick={handleSendCode}>
          Wyślij kod ponownie
        </Button>
      </div>
    );
  }

  if (step === "consent") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Zgoda na przetwarzanie wizerunku</h1>
        <p className="text-base text-muted-foreground">
          Za chwilę zrobisz zdjęcia prawa jazdy (przód i tył) oraz selfie. Selfie zostanie
          automatycznie porównane ze zdjęciem dokumentu — wynik pomaga naszemu zespołowi
          potwierdzić Twoją tożsamość.
        </p>
        <label className="flex items-start gap-3 text-left text-sm">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) => setConsentGiven(e.target.checked)}
            className="mt-1 size-5 shrink-0 rounded border-input"
          />
          <span>
            {BIOMETRIC_CONSENT_TEXT}{" "}
            <a href="/polityka-prywatnosci" target="_blank" className="underline">
              Polityka prywatności
            </a>
          </span>
        </label>
        {resumeAt !== "front" && (
          <p className="text-sm text-muted-foreground">
            {resumeAt === "back"
              ? "Przód prawa jazdy jest już zapisany — zaczniesz od tyłu."
              : resumeAt === "selfie"
                ? "Oba zdjęcia prawa jazdy są już zapisane — zostało selfie."
                : "Wszystkie zdjęcia są już zapisane — po zgodzie dokończymy weryfikację."}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!consentGiven || isPending}
          onClick={() => {
            if (resumeAt !== "finalize") {
              setStep(resumeAt);
              return;
            }
            // All three photos are in but no result was saved (the finalize
            // request was lost): finish with them rather than ask for more.
            setStep("finalizing");
            runFinalize();
          }}
        >
          Dalej
        </Button>
      </div>
    );
  }

  if (step === "front") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Krok 1 z 3: przód prawa jazdy</h1>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DocumentPhotoCapture
          key="front"
          label="Zrób zdjęcie przodu prawa jazdy"
          isSubmitting={isPending}
          onConfirm={(blob) => uploadDocumentPhoto("front", blob, "back")}
        />
      </div>
    );
  }

  if (step === "back") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Krok 2 z 3: tył prawa jazdy</h1>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DocumentPhotoCapture
          key="back"
          label="Zrób zdjęcie tyłu prawa jazdy"
          isSubmitting={isPending}
          autoStart
          onConfirm={(blob) => uploadDocumentPhoto("back", blob, "selfie")}
        />
      </div>
    );
  }

  if (step === "selfie") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Krok 3 z 3: selfie</h1>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {/* No close button here: there is no way to finish without a selfie,
            and the old "Kontynuuj bez selfie" promised a manual review that
            the server never accepted. What helps is the camera permission. */}
        <SelfieCapture
          isSubmitting={isPending}
          autoStart
          onConfirm={uploadSelfieThenFinalize}
          cameraHelp="Bez selfie nie da się dokończyć weryfikacji. Zezwól tej stronie na dostęp do aparatu (ustawienia przeglądarki albo ikona przy adresie strony) i odśwież stronę."
        />
      </div>
    );
  }

  if (step === "finalizing") {
    // The session is over (expired, closed by a newer code or the profile
    // form, or the identity is already verified): nothing is being analysed
    // any more and retrying cannot help, so the way on is the profile, as on
    // the server page for the same states. Not shown as an error: one of
    // these answers is good news.
    if (finalizeTerminal) {
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold">Ta sesja jest zamknięta</h1>
          {finalizeError && <p className="text-base text-muted-foreground">{finalizeError}</p>}
          <ContinueLink href={VERIFICATION_PATH} />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Analizujemy zdjęcia</h1>
        <p className="text-base text-muted-foreground">To może potrwać do minuty. Nie zamykaj tej strony.</p>
        <IndeterminateProgressBar />
        {finalizeError && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-destructive">{finalizeError}</p>
            <Button type="button" size="lg" disabled={isPending} onClick={runFinalize}>
              {isPending ? "Ponawianie…" : "Spróbuj ponownie"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (step === "review_needed") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Nie udało się potwierdzić automatycznie</h1>
        <p className="text-base text-muted-foreground">
          Selfie i zdjęcie dokumentu nie zostały dopasowane z wystarczającą pewnością — to często
          kwestia oświetlenia lub kąta, nie musi oznaczać problemu. Możesz spróbować zrobić selfie
          jeszcze raz albo wysłać zgłoszenie do ręcznej weryfikacji przez naszych administratorów.
        </p>
        {retryError && <p className="text-sm text-destructive">{retryError}</p>}
        <Button type="button" size="lg" className="w-full" disabled={isPending} onClick={retrySelfie}>
          {isPending ? "Przygotowanie…" : "Spróbuj jeszcze raz"}
        </Button>
        <Button type="button" variant="outline" size="lg" className="w-full" disabled={isPending} onClick={() => setStep("done")}>
          Wyślij do weryfikacji przez administratora
        </Button>
      </div>
    );
  }

  if (step === "loading_result") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Sprawdzamy wynik weryfikacji</h1>
        <IndeterminateProgressBar />
      </div>
    );
  }

  // This screen reports what the SERVER decided. Earlier it congratulated
  // anyone whose photos matched, while the desktop still showed "czeka na
  // weryfikację" — two screens, two stories, one confused user.
  if (approved) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Tożsamość potwierdzona ✓</h1>
        <p className="text-base text-muted-foreground">
          Gotowe — Twoje konto jest zweryfikowane. Możesz już dodać samochód albo zarezerwować
          auto. Tę stronę możesz zamknąć.
        </p>
        <ContinueLink />
      </div>
    );
  }

  // Only reachable by reloading a finished session after an admin rejected
  // it — the reason and the way forward are on the profile.
  if (verificationStatus === "rejected") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Weryfikacja wymaga poprawek</h1>
        <p className="text-base text-muted-foreground">
          Powód i instrukcję, co poprawić, znajdziesz w profilu na GoMambo, w sekcji „Weryfikacja
          tożsamości”.
        </p>
        <ContinueLink href={VERIFICATION_PATH} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-bold">Zdjęcia przesłane ✓</h1>
      {finalResult === "match" && (
        <p className="text-base text-primary">
          Zdjęcia pasują do siebie — automatyczne porównanie wypadło dobrze.
        </p>
      )}
      <p className="text-base text-muted-foreground">
        Zanim potwierdzimy, sprawdzi je jeszcze człowiek z zespołu GoMambo — zwykle w ciągu 24
        godzin. Powiadomimy Cię mailem. Tę stronę możesz zamknąć.
      </p>
      <ContinueLink />
    </div>
  );
}
