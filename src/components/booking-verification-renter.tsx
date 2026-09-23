"use client";

import { useState, useTransition } from "react";
import { SelfieCapture } from "@/components/selfie-capture";
import { submitBookingVerificationSelfie } from "@/app/dashboard/rentals/verification-actions";
import { Button } from "@/components/ui/button";
import type { BookingVerificationStatus } from "@/lib/booking-verification";

/**
 * The renter's side of the pre-rental check. Deliberately blunt about why it
 * exists: the car is handed over by a private individual or a local rental
 * company, and a booking is worth nothing to them if the person who turns up
 * isn't the person who booked.
 */
export function BookingVerificationRenter({
  bookingId,
  status,
}: {
  bookingId: string;
  status: BookingVerificationStatus;
}) {
  const [capturing, setCapturing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (status === "approved") {
    return (
      <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
        ✅ Tożsamość potwierdzona — dane do odbioru wyślemy dzień przed terminem.
      </p>
    );
  }

  if (status === "pending_owner") {
    return (
      <p className="rounded-md border p-3 text-xs">
        Selfie wysłane. Czekamy, aż właściciel potwierdzi — damy Ci znać. Nie musisz nic robić.
      </p>
    );
  }

  if (status === "escalated") {
    return (
      <p className="rounded-md border p-3 text-xs">
        Sprawdzamy jeszcze jeden szczegół tej rezerwacji. Odezwiemy się do Ciebie — Twoja
        płatność jest bezpieczna.
      </p>
    );
  }

  function upload(blob: Blob) {
    setError(null);
    if (!consent) {
      setError("Zaznacz zgodę na porównanie wizerunku.");
      return;
    }
    startTransition(async () => {
      // The image goes to the server, which picks the storage path itself.
      // When the browser chose it, a renter could pass the path of their own
      // ID document and have it compared against itself — a guaranteed match.
      const formData = new FormData();
      formData.append("selfie", blob, "selfie.jpg");
      formData.append("biometricConsent", "on");
      const result = await submitBookingVerificationSelfie(bookingId, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setCapturing(false);
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Potwierdź tożsamość przed odbiorem
      </p>
      <p className="text-xs">
        Zrób selfie. Osoba wydająca auto zobaczy je razem ze zdjęciami dokumentu, który przesłałeś
        przy weryfikacji konta, i potwierdzi, że to Ty odbierasz auto — tak jak przy ladzie w
        wypożyczalni, tylko wcześniej. Po potwierdzeniu traci do nich dostęp.{" "}
        <strong className="text-foreground">
          Bez tego nie wyślemy Ci numeru rejestracyjnego ani kontaktu do właściciela.
        </strong>
      </p>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Zgadzam się, aby osoba wydająca mi auto zobaczyła to selfie oraz zdjęcia dokumentu
          tożsamości, który przesłałem przy weryfikacji konta — po to, by potwierdzić, że to ja
          odbieram auto i że mój dokument jest ważny. Dostęp kończy się w chwili potwierdzenia.
        </span>
      </label>
      {capturing ? (
        <SelfieCapture
          onConfirm={upload}
          onSkip={() => setCapturing(false)}
          isSubmitting={isPending}
          autoStart
        />
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={() => setCapturing(true)}
          disabled={isPending || !consent}
        >
          {isPending ? "Wysyłam…" : "Zrób selfie"}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
