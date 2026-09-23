"use client";

import { useState, useTransition } from "react";
import { decideBookingVerification } from "@/app/dashboard/rentals/verification-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BookingVerificationStatus } from "@/lib/booking-verification";

/**
 * The host confirms the person, with the licence in front of them.
 *
 * Both routes into verification now collect a driving licence and nothing
 * else, so the host can be told exactly what they are looking at — and can
 * answer the question they actually have to answer, which is whether this
 * person may legally drive away in the car.
 *
 * Rejecting does not cancel anything — it hands the case to GoMambo, because
 * "this isn't the same person" is an accusation, and the host already has a
 * separate button to call the booking off outright.
 */
export function BookingVerificationOwner({
  bookingId,
  status,
  renterName,
  selfieUrl,
  licenceFrontUrl,
  licenceBackUrl,
  faceMatchResult,
  faceMatchScore,
}: {
  bookingId: string;
  status: BookingVerificationStatus;
  renterName: string;
  /** Short-lived signed URLs from the private bucket, minted only while this
   *  verification is still waiting on the host. After approval they stop
   *  being generated — GoMambo keeps the documents, the host does not. */
  selfieUrl: string | null;
  licenceFrontUrl: string | null;
  licenceBackUrl: string | null;
  faceMatchResult: "match" | "no_match" | "error" | "not_run" | null;
  faceMatchScore: number | null;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (status === "approved") {
    return <p className="text-xs">✅ Najemca potwierdzony przed wydaniem.</p>;
  }

  if (status === "pending_renter") {
    return (
      <p className="rounded-md border p-3 text-xs">
        Poprosiliśmy najemcę o świeże selfie przed odbiorem. Damy Ci znać, gdy będzie do
        potwierdzenia.
      </p>
    );
  }

  if (status === "escalated") {
    return (
      <p className="rounded-md border p-3 text-xs">
        Sprawę sprawdza GoMambo — odezwiemy się do Ciebie z decyzją.
      </p>
    );
  }

  function decide(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const result = await decideBookingVerification(bookingId, decision, reason);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setRejecting(false);
      setReason("");
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-medium text-foreground">Potwierdź najemcę przed wydaniem</p>
      <p className="text-xs">
        {renterName} przesłał świeże selfie przed odbiorem. Sprawdź dwie rzeczy: czy to ta sama
        osoba co na prawie jazdy i czy prawo jazdy jest nadal ważne — data w polu 4b. Po
        zatwierdzeniu te zdjęcia znikną z Twojego panelu.
      </p>
      {/* The host decides two things — is this the same person, and is the
          licence still valid — so they get the fresh selfie and both sides of
          the licence. Only until they decide: once approved, the page stops
          minting these links. */}
      <div className="flex flex-wrap gap-3">
        {selfieUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selfieUrl} alt="Selfie najemcy" className="max-h-44 rounded-md border" />
            <figcaption className="text-xs">Selfie zrobione teraz</figcaption>
          </figure>
        )}
        {licenceFrontUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={licenceFrontUrl}
              alt="Prawo jazdy najemcy — przód"
              className="max-h-44 rounded-md border"
            />
            <figcaption className="text-xs">Prawo jazdy — przód</figcaption>
          </figure>
        )}
        {licenceBackUrl && (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={licenceBackUrl}
              alt="Prawo jazdy najemcy — tył"
              className="max-h-44 rounded-md border"
            />
            <figcaption className="text-xs">Prawo jazdy — tył</figcaption>
          </figure>
        )}
      </div>
      {!licenceBackUrl && (
        <p className="text-xs">
          {licenceFrontUrl
            ? "Najemca przesłał tylko jedną stronę prawa jazdy — daty ważności może nie być widać."
            : "Nie mamy zdjęcia prawa jazdy tego najemcy. Sprawdź je przy wydaniu auta."}
        </p>
      )}
      <p className="text-xs">
        {faceMatchResult === "match" ? (
          <>
            Nasz automat porównał je z dokumentem:{" "}
            <strong className="text-foreground">
              zgodność{faceMatchScore !== null ? ` ${faceMatchScore.toFixed(0)}%` : ""}
            </strong>
            . To tylko podpowiedź — decyzja należy do Ciebie.
          </>
        ) : faceMatchResult === "no_match" ? (
          <>
            Uwaga: automat wykazał{" "}
            <strong className="text-foreground">
              niską zgodność{faceMatchScore !== null ? ` (${faceMatchScore.toFixed(0)}%)` : ""}
            </strong>{" "}
            z dokumentem. Może to być kwestia światła albo kąta, ale obejrzyj zdjęcie uważnie. Jeśli
            masz wątpliwości — zgłoś do nas zamiast potwierdzać.
          </>
        ) : (
          <>Automatycznego porównania nie udało się wykonać — oceń samodzielnie.</>
        )}
      </p>
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => decide("approve")} disabled={isPending}>
            {isPending ? "Chwileczkę…" : "Potwierdzam najemcę"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRejecting(true)}
            disabled={isPending}
          >
            Coś się nie zgadza
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs">
            Napisz, co budzi wątpliwości. To nie anuluje rezerwacji — sprawę rozstrzygnie GoMambo.
            Jeśli po prostu nie chcesz wydać auta, użyj „Odwołaj rezerwację”.
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="np. na selfie jest inna osoba niż na profilu"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => decide("reject")}
              disabled={isPending}
            >
              {isPending ? "Wysyłam…" : "Zgłoś do GoMambo"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRejecting(false)}
              disabled={isPending}
            >
              Anuluj
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
