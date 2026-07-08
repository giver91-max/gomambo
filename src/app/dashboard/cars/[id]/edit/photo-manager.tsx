"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { addCarPhoto, removeCarPhoto } from "./actions";
import { Input } from "@/components/ui/input";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 8;

type PhotoImage = { id: string; storagePath: string; url: string };

export function PhotoManager({
  carId,
  images,
}: {
  carId: string;
  images: PhotoImage[];
}) {
  const [photos, setPhotos] = useState(images);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAddFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setError(null);

    if (photos.length + files.length > MAX_IMAGES) {
      setError(`Maksymalnie ${MAX_IMAGES} zdjęć na ogłoszenie.`);
      return;
    }
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(`Plik "${file.name}" nie jest zdjęciem.`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`Zdjęcie "${file.name}" przekracza 5 MB.`);
        return;
      }
    }

    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Sesja wygasła. Zaloguj się ponownie.");
        return;
      }

      let nextPosition = photos.reduce((max, p, i) => Math.max(max, i), photos.length - 1) + 1;

      for (const file of files) {
        setStatus(`Wgrywanie zdjęcia „${file.name}"…`);
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${carId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("car-images")
          .upload(path, file, { contentType: file.type });

        if (uploadError) {
          setError(`Błąd wgrywania zdjęcia: ${uploadError.message}`);
          setStatus(null);
          return;
        }

        const position = nextPosition++;
        const result = await addCarPhoto(carId, path, position);
        if (result.error) {
          setError(result.error);
          setStatus(null);
          return;
        }

        const { data: publicUrl } = supabase.storage.from("car-images").getPublicUrl(path);
        setPhotos((prev) => [
          ...prev,
          { id: path, storagePath: path, url: publicUrl.publicUrl },
        ]);
      }

      setStatus(null);
    });
  }

  function handleRemove(photo: PhotoImage) {
    setError(null);
    if (photos.length <= 1) {
      setError("Ogłoszenie musi mieć przynajmniej jedno zdjęcie.");
      return;
    }
    setRemovingId(photo.id);
    startTransition(async () => {
      const result = await removeCarPhoto(carId, photo.id, photo.storagePath);
      if (result.error) {
        setError(result.error);
      } else {
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      }
      setRemovingId(null);
    });
  }

  return (
    <div className="space-y-3">
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-md">
              <Image src={photo.url} alt="Zdjęcie auta" fill sizes="25vw" className="object-cover" />
              <button
                type="button"
                onClick={() => handleRemove(photo)}
                disabled={isPending}
                className="absolute right-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
              >
                {removingId === photo.id ? "…" : "Usuń"}
              </button>
            </div>
          ))}
        </div>
      )}

      {photos.length < MAX_IMAGES && (
        <div className="space-y-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleAddFiles}
            disabled={isPending}
          />
          <p className="text-xs text-muted-foreground">
            Możesz dodać jeszcze {MAX_IMAGES - photos.length} zdjęć (max 5 MB każde).
          </p>
        </div>
      )}

      {status && <p className="text-sm text-muted-foreground">{status}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {photos.length === 0 && (
        <p className="text-sm text-destructive">
          Ogłoszenie musi mieć przynajmniej jedno zdjęcie.
        </p>
      )}
    </div>
  );
}
