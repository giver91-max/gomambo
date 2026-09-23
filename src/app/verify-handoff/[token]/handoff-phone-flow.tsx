"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
import type { FaceMatchResult, HandoffStatus } from "@/types/database";

type Step =
  | "send_code"
  | "enter_code"
  | "consent"
  | "front"
  | "back"
  | "selfie"
  | "finalizing"
  | "review_needed"
  | "done";

function stepFromStatus(status: HandoffStatus): Step {
  if (status === "pending") return "send_code";
  if (status === "code_sent") return "enter_code";
  if (status === "claimed" || status === "photos_uploaded") return "consent";
  return "done";
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Coś poszło nie tak. Spróbuj ponownie.";
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
}: {
  token: string;
  initialStatus: HandoffStatus;
  maskedEmail: string;
}) {
  const [step, setStep] = useState<Step>(stepFromStatus(initialStatus));
  const [consentGiven, setConsentGiven] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<FaceMatchResult | null>(null);
  // Whether the server actually approved the verification, not whether the
  // photos looked alike. These are different answers and the screen must not
  // guess: telling someone "potwierdzone" while the desktop still says
  // "czeka na weryfikację" is the bug this flag exists to prevent.
  const [approved, setApproved] = useState(false);
  const [isPending, startTransition] = useTransition();

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
    startTransition(async () => {
      try {
        const result = await finalizeHandoff(token);
        if (result.error) {
          setFinalizeError(result.error);
          return;
        }
        setFinalResult(result.result ?? null);
        setApproved(result.approved ?? false);
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
            Wyrażam zgodę na przetworzenie mojego wizerunku (zdjęcia dokumentu i selfie) w celu
            weryfikacji tożsamości na GoMambo.
          </span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" size="lg" className="w-full" disabled={!consentGiven} onClick={() => setStep("front")}>
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
        <SelfieCapture
          isSubmitting={isPending}
          autoStart
          onConfirm={uploadSelfieThenFinalize}
          onSkip={() => setError("Selfie jest wymagane do automatycznego porównania — zrób zdjęcie, żeby kontynuować.")}
        />
      </div>
    );
  }

  if (step === "finalizing") {
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

  // This screen reports what the SERVER decided. Earlier it congratulated
  // anyone whose photos matched, while the desktop still showed "czeka na
  // weryfikację" — two screens, two stories, one confused user.
  if (approved) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">Tożsamość potwierdzona ✓</h1>
        <p className="text-base text-muted-foreground">
          Gotowe — Twoje konto jest zweryfikowane. Możesz wrócić do urządzenia, z którego
          zeskanowałeś kod QR, i dodać samochód albo zarezerwować auto.
        </p>
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
        godzin. Powiadomimy Cię mailem. Możesz wrócić do urządzenia, z którego zeskanowałeś kod QR.
      </p>
    </div>
  );
}
