"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { approveCar, rejectCar, revertCarToPending } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteCarButton } from "@/app/dashboard/cars/[id]/edit/delete-car-button";
import { formatPriceZl } from "@/lib/money-format";
import { todayInPoland } from "@/lib/calendar";
import type { CarStatus } from "@/types/database";

type Props = {
  car: {
    id: string;
    brand: string;
    model: string;
    year: number;
    city: string;
    price_per_day: number;
    description: string | null;
    status: CarStatus;
    rejection_reason: string | null;
    registration_number: string | null;
    insurance_valid_until: string | null;
    inspection_valid_until: string | null;
    rental_right_confirmed_at: string | null;
  };
  ownerName: string;
  // Set when the car belongs to a rental company rather than an individual.
  partnerName: string | null;
  partnerStatus: string | null;
  partnerStatusLabel: string | null;
  // Private owner only: how their identity verification stands.
  ownerVerificationLabel: string | null;
  ownerVerified: boolean;
  // What still stops approval (approval-gate.ts); empty when nothing does.
  missing: string[];
  imageUrls: string[];
  insuranceUrl: string | null;
  insuranceIsPdf: boolean;
};

function DocumentDates({ car }: { car: Props["car"] }) {
  // Plain YYYY-MM-DD comparison — the dates are calendar days, not instants.
  // The Polish day, not the machine's: this renders on the server (UTC) and
  // again in the browser, and the two must agree around midnight.
  const today = todayInPoland();
  const row = (label: string, value: string | null) => (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {value ? (
        <span className={value < today ? "font-medium text-destructive" : "font-medium"}>
          {value.split("-").reverse().join(".")}
          {value < today ? " (WYGASŁO)" : ""}
        </span>
      ) : (
        <span className="text-muted-foreground">brak daty</span>
      )}
    </p>
  );
  return (
    <div className="mt-1 space-y-0.5">
      {row("OC ważne do", car.insurance_valid_until)}
      {row("Przegląd ważny do", car.inspection_valid_until)}
      <p>
        <span className="text-muted-foreground">Prawo do wynajmu: </span>
        {car.rental_right_confirmed_at ? (
          <span className="font-medium">potwierdzone przez właściciela</span>
        ) : (
          <span className="text-muted-foreground">brak oświadczenia</span>
        )}
      </p>
    </div>
  );
}

export function CarReviewCard({
  car,
  ownerName,
  partnerName,
  partnerStatus,
  partnerStatusLabel,
  ownerVerificationLabel,
  ownerVerified,
  missing,
  imageUrls,
  insuranceUrl,
  insuranceIsPdf,
}: Props) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const carLabel = `${car.brand} ${car.model} (${car.year})`;
  const trimmedReason = reason.trim();
  const canApprove = missing.length === 0;

  // On an error the card is NOT refreshed: the car may have changed status
  // meanwhile (e.g. paused by the database), and a refresh would drop it from
  // this tab together with the only message explaining why.
  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("Nie udało się zapisać — sprawdź połączenie i spróbuj ponownie.");
      }
    });
  }

  // Both decisions mail the owner, so a stray tap while scrolling on a phone
  // must not be enough.
  function handleApprove() {
    if (!confirm(`Zatwierdzić auto ${carLabel}? Właściciel dostanie e-mail, że ogłoszenie jest zatwierdzone.`)) {
      return;
    }
    run(() => approveCar(car.id));
  }

  function handleReject() {
    if (!trimmedReason) {
      setError("Napisz powód — właściciel musi wiedzieć, co poprawić.");
      return;
    }
    if (!confirm(`Odrzucić auto ${carLabel}? Właściciel dostanie e-mail z tym powodem.`)) {
      return;
    }
    run(() => rejectCar(car.id, trimmedReason));
  }

  function handleRevertToPending() {
    run(() => revertCarToPending(car.id));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            {car.brand} {car.model} ({car.year})
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {partnerName ? "Wypożyczalnia" : "Właściciel"}:{" "}
            {partnerName || ownerName || "brak danych"} · {car.city} ·{" "}
            {formatPriceZl(car.price_per_day)}/dzień
          </p>
          {/* A car of a company that is not active cannot be published —
              the database would force it straight back to 'paused' — so
              approval waits for the company, and the reviewer sees why. */}
          {partnerName && partnerStatus !== "active" && (
            <p className="text-sm text-destructive">
              Wypożyczalnia nie jest aktywna ({partnerStatusLabel ?? partnerStatus}) —{" "}
              {car.status === "pending"
                ? "zweryfikuj najpierw firmę w zakładce Wypożyczalnie, potem zatwierdzisz to auto."
                : "auto nie będzie widoczne w katalogu, dopóki nie zweryfikujesz firmy."}
            </p>
          )}
        </div>
        <Badge
          variant={
            car.status === "approved"
              ? "default"
              : car.status === "rejected"
                ? "destructive"
                : "secondary"
          }
        >
          {car.status === "pending"
            ? "Oczekuje"
            : car.status === "approved"
              ? "Zatwierdzone"
              : car.status === "paused"
                ? "Wstrzymane"
                : "Odrzucone"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {car.description && (
          <p className="text-sm text-muted-foreground">{car.description}</p>
        )}

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p>
            <span className="text-muted-foreground">Nr rejestracyjny: </span>
            <span className="font-medium">{car.registration_number ?? "brak"}</span>
            {car.registration_number && (
              <>
                {" "}
                ·{" "}
                <a
                  href="https://www.ufg.pl"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Sprawdź OC w UFG →
                </a>
              </>
            )}
          </p>
          <DocumentDates car={car} />
          {ownerVerificationLabel && (
            <p>
              <span className="text-muted-foreground">Weryfikacja tożsamości właściciela: </span>
              <span className={ownerVerified ? "font-medium" : "font-medium text-destructive"}>
                {ownerVerificationLabel}
              </span>
            </p>
          )}
          <div className="mt-2">
            {insuranceUrl ? (
              insuranceIsPdf ? (
                <a
                  href={insuranceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Zobacz polisę OC (PDF) →
                </a>
              ) : (
                <div className="relative h-40 w-full max-w-xs overflow-hidden rounded-md border">
                  <Image
                    src={insuranceUrl}
                    alt="Polisa OC"
                    fill
                    sizes="320px"
                    className="object-contain"
                    unoptimized
                  />
                </div>
              )
            ) : (
              <p className="text-muted-foreground">Brak wgranej polisy OC.</p>
            )}
          </div>
        </div>

        {imageUrls.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {imageUrls.map((src, i) => (
              <div key={i} className="relative aspect-square w-full overflow-hidden rounded-md">
                <Image
                  src={src}
                  alt={`Zdjęcie ${i + 1}`}
                  fill
                  sizes="25vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        )}

        {car.status === "rejected" && car.rejection_reason && (
          <p className="text-sm text-destructive">
            Powód odrzucenia: {car.rejection_reason}
          </p>
        )}

        {/* Shown on every tab, not only to block approval: an approved car
            listed before these were required is exactly what needs a look
            before the catalogue opens. */}
        {missing.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              {car.status === "pending"
                ? "Nie można jeszcze zatwierdzić — brakuje:"
                : "Temu ogłoszeniu brakuje:"}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {car.status === "pending" && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={handleApprove} disabled={isPending || !canApprove} size="sm">
              Zatwierdź
            </Button>
            {/* Its own full-width row on a phone, where squeezed between the
                buttons it showed only "Powód"; one row with them from sm up. */}
            <Textarea
              placeholder="Powód odrzucenia (wymagany) — właściciel zobaczy go w e-mailu"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="min-h-16 basis-full sm:h-9 sm:min-h-9 sm:basis-0 sm:flex-1"
              disabled={isPending}
            />
            <Button
              onClick={handleReject}
              disabled={isPending || !trimmedReason}
              size="sm"
              variant="destructive"
            >
              Odrzuć
            </Button>
          </div>
        )}

        {car.status !== "pending" && (
          <div className="pt-2">
            <Button
              onClick={handleRevertToPending}
              disabled={isPending}
              size="sm"
              variant="outline"
            >
              Cofnij do oczekujących
            </Button>
          </div>
        )}

        <div className="flex items-center gap-4 border-t pt-3">
          <Link
            href={`/dashboard/cars/${car.id}/edit`}
            className="text-sm text-primary hover:underline"
          >
            Edytuj →
          </Link>
          <DeleteCarButton carId={car.id} redirectTo="/admin/cars" />
        </div>
      </CardContent>
    </Card>
  );
}
