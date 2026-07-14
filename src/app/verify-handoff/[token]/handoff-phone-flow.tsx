"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      <Card>
        <CardContent className="space-y-3 py-8">
          <h1 className="text-lg font-semibold">Weryfikacja tożsamości</h1>
          <p className="text-sm text-muted-foreground">
            Wyślemy jednorazowy kod na Twój adres e-mail: <strong>{maskedEmail}</strong>
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" disabled={isPending} onClick={handleSendCode}>
            {isPending ? "Wysyłanie…" : "Wyślij kod e-mail"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === "enter_code") {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <h1 className="text-lg font-semibold">Wpisz kod z e-maila</h1>
          <p className="text-sm text-muted-foreground">
            Kod wysłaliśmy na <strong>{maskedEmail}</strong>.
          </p>
          <Input
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={isPending || code.length !== 6} onClick={handleClaim}>
              {isPending ? "Sprawdzanie…" : "Potwierdź"}
            </Button>
            <Button type="button" variant="ghost" disabled={isPending} onClick={handleSendCode}>
              Wyślij kod ponownie
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "consent") {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <h1 className="text-lg font-semibold">Zgoda na przetwarzanie wizerunku</h1>
          <p className="text-sm text-muted-foreground">
            Za chwilę zrobisz zdjęcia prawa jazdy (przód i tył) oraz selfie. Selfie zostanie
            automatycznie porównane ze zdjęciem dokumentu w celu potwierdzenia Twojej tożsamości.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
              className="mt-1 size-4 shrink-0 rounded border-input"
            />
            <span>
              Wyrażam zgodę na przetworzenie mojego wizerunku (zdjęcia dokumentu i selfie) w celu
              weryfikacji tożsamości na GoMambo.
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" disabled={!consentGiven} onClick={() => setStep("front")}>
            Dalej
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === "front") {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <h1 className="text-lg font-semibold">Krok 1 z 3: przód prawa jazdy</h1>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DocumentPhotoCapture
            label="Zrób zdjęcie przodu prawa jazdy"
            onCapture={(blob) => uploadPhoto("front", blob, "back")}
          />
        </CardContent>
      </Card>
    );
  }

  if (step === "back") {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <h1 className="text-lg font-semibold">Krok 2 z 3: tył prawa jazdy</h1>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DocumentPhotoCapture
            label="Zrób zdjęcie tyłu prawa jazdy"
            onCapture={(blob) => uploadPhoto("back", blob, "selfie")}
          />
        </CardContent>
      </Card>
    );
  }

  if (step === "selfie") {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <h1 className="text-lg font-semibold">Krok 3 z 3: selfie</h1>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <SelfieCapture
            onCapture={(blob) => uploadPhoto("selfie", blob, "finalizing")}
            onSkip={() => setError("Selfie jest wymagane do automatycznego porównania — zrób zdjęcie, żeby kontynuować.")}
          />
        </CardContent>
      </Card>
    );
  }

  if (step === "finalizing") {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Przetwarzanie…</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2 py-8 text-center">
        <h1 className="text-lg font-semibold">Gotowe ✓</h1>
        <p className="text-sm text-muted-foreground">
          Zdjęcia zostały przesłane. Wróć do urządzenia, na którym zeskanowałeś kod QR, żeby zobaczyć wynik
          weryfikacji.
        </p>
      </CardContent>
    </Card>
  );
}
