"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { approveCar, rejectCar, revertCarToPending } from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteCarButton } from "@/app/dashboard/cars/[id]/edit/delete-car-button";
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
  };
  ownerName: string;
  imageUrls: string[];
};

export function CarReviewCard({ car, ownerName, imageUrls }: Props) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveCar(car.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Błąd");
      }
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      try {
        await rejectCar(car.id, reason);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Błąd");
      }
    });
  }

  function handleRevertToPending() {
    setError(null);
    startTransition(async () => {
      try {
        await revertCarToPending(car.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Błąd");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            {car.brand} {car.model} ({car.year})
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Właściciel: {ownerName || "brak danych"} · {car.city} ·{" "}
            {Number(car.price_per_day).toFixed(2)} zł/dzień
          </p>
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

        {error && <p className="text-sm text-destructive">{error}</p>}

        {car.status === "pending" && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={handleApprove} disabled={isPending} size="sm">
              Zatwierdź
            </Button>
            <Textarea
              placeholder="Powód odrzucenia (opcjonalnie)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-9 min-h-9 flex-1"
              disabled={isPending}
            />
            <Button
              onClick={handleReject}
              disabled={isPending}
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
          <DeleteCarButton carId={car.id} redirectTo="/admin" />
        </div>
      </CardContent>
    </Card>
  );
}
