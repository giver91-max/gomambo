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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 8;

export function NewCarForm() {
  const [previews, setPreviews] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [stickers, setStickers] = useState<(StickerRect | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

    const formData = new FormData(e.currentTarget);
    // The "images" field still holds the raw File objects from the file
    // input (FormData captures every named control in the form) — strip it
    // so this request stays tiny; photos upload directly to Storage below.
    formData.delete("images");
    const filesToUpload = files;
    const stickersToUpload = stickers;

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

      setStatus("Finalizowanie…");
      const finalize = await attachCarImages(carId, uploaded);
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
