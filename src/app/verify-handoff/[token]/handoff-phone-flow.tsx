"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentPhotoCapture } from "@/components/document-photo-capture";
import { SelfieCapture } from "@/components/selfie-capture";
import { claimHandoff, finalizeHandoff, sendHandoffCode, uploadHandoffPhoto } from "./actions";
import type { HandoffStatus } from "@/types/database";

type Step = "send_code" | "enter_code" | "consent" | "front" | "back" | "selfie" | "finalizing" | "done";

function stepFromStatus(status: HandoffStatus): Step {
  if (status === "pending") return "send_code";
  if (status === "code_sent") return "enter_code";
  if (status === "claimed" || status === "photos_uploaded") return "consent";
  return "done";
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
  const [isPending, startTransition] = useTransition();

  function handleSendCode() {
    setError(null);
    startTransition(async () => {
      const result = await sendHandoffCode(token);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStep("enter_code");
    });
  }

  function handleClaim() {
    setError(null);
    startTransition(async () => {
      const result = await claimHandoff(token, code);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStep("consent");
    });
  }

  function uploadPhoto(kind: "front" | "back" | "selfie", blob: Blob, nextStep: Step) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", blob, `${kind}.jpg`);
      const result = await uploadHandoffPhoto(token, kind, consentGiven, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (nextStep === "finalizing") {
        const finalizeResult = await finalizeHandoff(token);
        if (finalizeResult.error) {
          setError(finalizeResult.error);
          return;
        }
      }
      setStep(nextStep);
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
          automatycznie porównane ze zdjęciem dokumentu w celu potwierdzenia Twojej tożsamości.
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
          label="Zrób zdjęcie przodu prawa jazdy"
          onCapture={(blob) => uploadPhoto("front", blob, "back")}
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
          label="Zrób zdjęcie tyłu prawa jazdy"
          onCapture={(blob) => uploadPhoto("back", blob, "selfie")}
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
          onCapture={(blob) => uploadPhoto("selfie", blob, "finalizing")}
          onSkip={() => setError("Selfie jest wymagane do automatycznego porównania — zrób zdjęcie, żeby kontynuować.")}
        />
      </div>
    );
  }

  if (step === "finalizing") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg text-muted-foreground">Przetwarzanie…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-bold">Gotowe ✓</h1>
      <p className="text-base text-muted-foreground">
        Zdjęcia zostały przesłane. Wróć do urządzenia, na którym zeskanowałeś kod QR, żeby zobaczyć
        wynik weryfikacji.
      </p>
    </div>
  );
}
