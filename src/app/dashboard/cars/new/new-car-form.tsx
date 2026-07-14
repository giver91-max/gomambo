"use client";

import { useState, useTransition } from "react";
import { createCarDraft, deleteCarDraft, attachCarImages } from "../actions";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getRecaptchaToken } from "@/lib/recaptcha-client";
import { PlateCoverEditor } from "@/components/plate-cover-editor";
import { DEFAULT_STICKER, flattenImageWithSticker, type StickerRect } from "@/lib/plate-cover";
import {
  CANCELLATION_POLICY_DESCRIPTIONS,
  CANCELLATION_POLICY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_TYPE_LABELS,
} from "@/lib/car-options";
import type { CancellationPolicy, FuelType, Transmission, VehicleType } from "@/types/database";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 8;
const MAX_INSURANCE_BYTES = 8 * 1024 * 1024;

export function NewCarForm() {
  const [previews, setPreviews] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [stickers, setStickers] = useState<(StickerRect | null)[]>([]);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);

  function handleInsuranceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setInsuranceFile(file);
  }

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setPreviews((old) => {
      old.forEach((url) => URL.revokeObjectURL(url));
      return selected.map((f) => URL.createObjectURL(f));
    });
    setFiles(selected);
    setStickers(selected.map(() => DEFAULT_STICKER));
  }

  function updateSticker(index: number, rect: StickerRect) {
    setStickers((prev) => prev.map((s, i) => (i === index ? rect : s)));
  }

  function toggleSticker(index: number) {
    setStickers((prev) => prev.map((s, i) => (i === index ? (s ? null : DEFAULT_STICKER) : s)));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (files.length === 0) {
      setError("Dodaj przynajmniej jedno zdjęcie auta.");
      return;
    }
    if (files.length > MAX_IMAGES) {
      setError(`Maksymalnie ${MAX_IMAGES} zdjęć.`);
      return;
    }
    for (const image of files) {
      if (!image.type.startsWith("image/")) {
        setError(`Plik "${image.name}" nie jest zdjęciem.`);
        return;
      }
      if (image.size > MAX_IMAGE_BYTES) {
        setError(`Zdjęcie "${image.name}" przekracza 5 MB.`);
        return;
      }
    }
    if (!insuranceFile) {
      setError("Dodaj skan lub zdjęcie polisy OC.");
      return;
    }
    if (insuranceFile.size > MAX_INSURANCE_BYTES) {
      setError("Plik polisy OC przekracza 8 MB.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    // The "images"/"insurance" fields still hold raw File objects from the
    // file inputs (FormData captures every named control in the form) —
    // strip them so this request stays tiny; files upload directly to
    // Storage below.
    formData.delete("images");
    formData.delete("insurance");
    const filesToUpload = files;
    const stickersToUpload = stickers;
    const insuranceToUpload = insuranceFile;

    startTransition(async () => {
      setStatus("Zapisywanie danych auta…");
      const token = await getRecaptchaToken("add_car");
      formData.set("recaptchaToken", token ?? "");
      const draft = await createCarDraft({ error: null }, formData);
      if (draft.error || !draft.carId) {
        setError(draft.error ?? "Nie udało się zapisać auta.");
        setStatus(null);
        return;
      }
      const carId = draft.carId;

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Sesja wygasła. Zaloguj się ponownie.");
        setStatus(null);
        await deleteCarDraft(carId);
        return;
      }

      const uploaded: { path: string; position: number }[] = [];

      for (let index = 0; index < filesToUpload.length; index++) {
        setStatus(`Wgrywanie zdjęcia ${index + 1} z ${filesToUpload.length}…`);
        const image = await flattenImageWithSticker(filesToUpload[index], stickersToUpload[index]);
        const ext = image.name.split(".").pop() || "jpg";
        const path = `${user.id}/${carId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("car-images")
          .upload(path, image, { contentType: image.type });

        if (uploadError) {
          setError(`Błąd wgrywania zdjęcia: ${uploadError.message}`);
          setStatus(null);
          if (uploaded.length > 0) {
            await supabase.storage.from("car-images").remove(uploaded.map((u) => u.path));
          }
          await deleteCarDraft(carId);
          return;
        }

        uploaded.push({ path, position: index });
      }

      setStatus("Wgrywanie polisy OC…");
      const insuranceExt = insuranceToUpload.name.split(".").pop() || "jpg";
      const insurancePath = `${user.id}/${carId}/${crypto.randomUUID()}.${insuranceExt}`;
      const { error: insuranceUploadError } = await supabase.storage
        .from("car-insurance")
        .upload(insurancePath, insuranceToUpload, { contentType: insuranceToUpload.type });

      if (insuranceUploadError) {
        setError(`Błąd wgrywania polisy OC: ${insuranceUploadError.message}`);
        setStatus(null);
        if (uploaded.length > 0) {
          await supabase.storage.from("car-images").remove(uploaded.map((u) => u.path));
        }
        await deleteCarDraft(carId);
        return;
      }

      setStatus("Finalizowanie…");
      const finalize = await attachCarImages(carId, uploaded, insurancePath);
      // attachCarImages redirects on success instead of returning a value —
      // only handle the result on failure, otherwise the page is navigating away.
      if (finalize?.error) {
        setError(finalize.error);
        setStatus(null);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="brand">Marka</Label>
          <Input id="brand" name="brand" required placeholder="Toyota" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" required placeholder="Corolla" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="year">Rok produkcji</Label>
          <Input
            id="year"
            name="year"
            type="number"
            required
            min={1990}
            max={new Date().getFullYear() + 1}
            placeholder="2020"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price_per_day">Cena / dzień (zł)</Label>
          <Input
            id="price_per_day"
            name="price_per_day"
            type="number"
            step="0.01"
            min={1}
            required
            placeholder="150"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="city">Miasto</Label>
        <Input id="city" name="city" required placeholder="Warszawa" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="vehicle_type">Typ pojazdu</Label>
          <select
            id="vehicle_type"
            name="vehicle_type"
            required
            defaultValue=""
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Wybierz typ
            </option>
            {(Object.entries(VEHICLE_TYPE_LABELS) as [VehicleType, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fuel_type">Rodzaj paliwa</Label>
          <select
            id="fuel_type"
            name="fuel_type"
            required
            defaultValue=""
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Wybierz paliwo
            </option>
            {(Object.entries(FUEL_TYPE_LABELS) as [FuelType, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="transmission">Skrzynia biegów</Label>
          <select
            id="transmission"
            name="transmission"
            required
            defaultValue=""
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="" disabled>
              Wybierz skrzynię
            </option>
            {(Object.entries(TRANSMISSION_LABELS) as [Transmission, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="seats">Liczba miejsc</Label>
          <Input id="seats" name="seats" type="number" min={1} max={9} required placeholder="5" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mileage_limit_km">Limit km / dzień (opcjonalnie)</Label>
          <Input
            id="mileage_limit_km"
            name="mileage_limit_km"
            type="number"
            min={1}
            placeholder="bez limitu"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price_per_month">Cena / miesiąc (zł, opcjonalnie)</Label>
          <Input
            id="price_per_month"
            name="price_per_month"
            type="number"
            step="0.01"
            min={1}
            placeholder="np. 2400"
          />
          <p className="text-xs text-muted-foreground">
            Zniżkowa cena dla wynajmu 28 dni i dłużej.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="delivery_available"
            value="true"
            checked={deliveryAvailable}
            onChange={(e) => setDeliveryAvailable(e.target.checked)}
            className="size-4"
          />
          Oferuję dowóz auta
        </label>
        {deliveryAvailable && (
          <Input
            name="delivery_info"
            placeholder="np. Dowóz w promieniu 20 km za 50 zł, na lotnisko za 100 zł"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cancellation_policy">Polityka anulowania</Label>
        <select
          id="cancellation_policy"
          name="cancellation_policy"
          defaultValue="moderate"
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {(Object.entries(CANCELLATION_POLICY_LABELS) as [CancellationPolicy, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label} — {CANCELLATION_POLICY_DESCRIPTIONS[value]}
              </option>
            )
          )}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="registration_number">Numer rejestracyjny</Label>
        <Input
          id="registration_number"
          name="registration_number"
          required
          placeholder="WX 12345"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="insurance">Polisa OC (zdjęcie lub PDF, do 8 MB)</Label>
        <Input
          id="insurance"
          name="insurance"
          type="file"
          accept="image/*,application/pdf"
          required
          onChange={handleInsuranceChange}
        />
        <p className="text-xs text-muted-foreground">
          Dokument widzi tylko nasz zespół podczas weryfikacji ogłoszenia.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Opis (opcjonalnie)</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          placeholder="Dodatkowe informacje o aucie…"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="images">Zdjęcia auta (max 8, do 5 MB każde)</Label>
        <p className="text-xs text-muted-foreground">
          Dobre zdjęcia realnie zwiększają liczbę zapytań: rób je w świetle dziennym, pokaż
          auto z czterech stron, dodaj wnętrze i deskę rozdzielczą, i posprzątaj przed sesją.
        </p>
        <Input
          id="images"
          name="images"
          type="file"
          accept="image/*"
          multiple
          required
          onChange={handleFilesChange}
        />
        {previews.length > 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Przeciągnij nasze logo, aby ukryć swoją tablicę rejestracyjną. Jeśli na
              zdjęciu nie widać tablicy, możesz je pominąć.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {previews.map((src, i) => (
                <div key={i} className="space-y-1">
                  <PlateCoverEditor
                    imageUrl={src}
                    sticker={stickers[i] ?? null}
                    onChange={(rect) => updateSticker(i, rect)}
                  />
                  <button
                    type="button"
                    onClick={() => toggleSticker(i)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {stickers[i]
                      ? "Nie widać tablicy na tym zdjęciu — usuń logo"
                      : "Przywróć logo na tym zdjęciu"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? status ?? "Chwileczkę…" : "Dodaj auto do weryfikacji"}
      </Button>
    </form>
  );
}
