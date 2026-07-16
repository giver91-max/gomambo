"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import {
  addTripPhoto,
  removeTripPhoto,
  updateTripCondition,
} from "@/app/dashboard/bookings/trip-photos-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FUEL_LEVEL_LABELS } from "@/lib/car-options";
import type { FuelLevel, TripPhotoStage } from "@/types/database";

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function TripConditionForm({
  bookingId,
  stage,
  odometerKm,
  fuelLevel,
}: {
  bookingId: string;
  stage: TripPhotoStage;
  odometerKm: number | null;
  fuelLevel: FuelLevel | null;
}) {
  const [odometer, setOdometer] = useState(odometerKm != null ? String(odometerKm) : "");
  const [fuel, setFuel] = useState<FuelLevel | "">(fuelLevel ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    const odometerValue = odometer.trim() ? Number(odometer) : null;
    if (odometerValue !== null && (!Number.isFinite(odometerValue) || odometerValue < 0)) {
      setError("Podaj prawidłowy stan licznika.");
      return;
    }
    startTransition(async () => {
      const result = await updateTripCondition(
        bookingId,
        stage,
        odometerValue,
        fuel || null
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={0}
          placeholder="Stan licznika (km)"
          value={odometer}
          onChange={(e) => {
            setOdometer(e.target.value);
            setSaved(false);
          }}
        />
        <select
          className={selectClassName}
          value={fuel}
          onChange={(e) => {
            setFuel(e.target.value as FuelLevel | "");
            setSaved(false);
          }}
        >
          <option value="">Poziom paliwa</option>
          {(Object.entries(FUEL_LEVEL_LABELS) as [FuelLevel, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? "Zapisywanie…" : "Zapisz stan auta"}
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Zapisano.</span>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type TripPhotoItem = {
  id: string;
  url: string;
  storagePath: string;
  uploaderId: string;
};

function PhotoStageSection({
  bookingId,
  stage,
  label,
  photos,
  currentUserId,
  odometerKm,
  fuelLevel,
}: {
  bookingId: string;
  stage: TripPhotoStage;
  label: string;
  photos: TripPhotoItem[];
  currentUserId: string;
  odometerKm: number | null;
  fuelLevel: FuelLevel | null;
}) {
  const [items, setItems] = useState(photos);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(`Plik "${file.name}" nie jest zdjęciem.`);
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`Zdjęcie "${file.name}" przekracza 5 MB.`);
        return;
      }
    }

    startTransition(async () => {
      const supabase = createClient();
      for (const file of files) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${bookingId}/${stage}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("trip-photos")
          .upload(path, file, { contentType: file.type });
        if (uploadError) {
          setError(`Błąd wgrywania: ${uploadError.message}`);
          continue;
        }
        const result = await addTripPhoto(bookingId, stage, path);
        if (result.error) {
          setError(result.error);
          continue;
        }
        const { data: signed } = await supabase.storage
          .from("trip-photos")
          .createSignedUrl(path, 60 * 5);
        if (signed?.signedUrl) {
          setItems((prev) => [
            ...prev,
            { id: path, url: signed.signedUrl, storagePath: path, uploaderId: currentUserId },
          ]);
        }
      }
    });
  }

  function handleRemove(item: TripPhotoItem) {
    startTransition(async () => {
      await removeTripPhoto(item.id, item.storagePath);
      setItems((prev) => prev.filter((p) => p.id !== item.id));
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div key={item.id} className="group relative size-20 overflow-hidden rounded-md border">
              <Image
                src={item.url}
                alt={label}
                fill
                sizes="80px"
                className="object-cover"
                unoptimized
              />
              {item.uploaderId === currentUserId && (
                <button
                  type="button"
                  onClick={() => handleRemove(item)}
                  disabled={isPending}
                  className="absolute right-0.5 top-0.5 hidden size-5 rounded-full bg-black/70 text-xs text-white group-hover:block"
                  aria-label="Usuń zdjęcie"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {isPending ? "Wgrywanie…" : "Dodaj zdjęcia"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <TripConditionForm
        bookingId={bookingId}
        stage={stage}
        odometerKm={odometerKm}
        fuelLevel={fuelLevel}
      />
    </div>
  );
}

export function TripPhotosManager({
  bookingId,
  currentUserId,
  pickupPhotos,
  returnPhotos,
  pickupOdometerKm,
  pickupFuelLevel,
  returnOdometerKm,
  returnFuelLevel,
}: {
  bookingId: string;
  currentUserId: string;
  pickupPhotos: TripPhotoItem[];
  returnPhotos: TripPhotoItem[];
  pickupOdometerKm: number | null;
  pickupFuelLevel: FuelLevel | null;
  returnOdometerKm: number | null;
  returnFuelLevel: FuelLevel | null;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Dokumentacja stanu auta</p>
      <p className="text-xs text-muted-foreground">
        Dodajcie zdjęcia auta oraz zapiszcie stan licznika i poziom paliwa przy odbiorze i
        zwrocie — to ułatwia wyjaśnienie ewentualnych sporów. Widzą to tylko strony tej
        rezerwacji.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PhotoStageSection
          bookingId={bookingId}
          stage="pickup"
          label="Odbiór"
          photos={pickupPhotos}
          currentUserId={currentUserId}
          odometerKm={pickupOdometerKm}
          fuelLevel={pickupFuelLevel}
        />
        <PhotoStageSection
          bookingId={bookingId}
          stage="return"
          label="Zwrot"
          photos={returnPhotos}
          currentUserId={currentUserId}
          odometerKm={returnOdometerKm}
          fuelLevel={returnFuelLevel}
        />
      </div>
    </div>
  );
}
