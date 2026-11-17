"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { addCarPhoto, removeCarPhoto } from "./actions";
import { Input } from "@/components/ui/input";
import {
  checkPhotoFile,
  fileExtension,
  MAX_UPLOAD_IMAGE_BYTES,
  resizeImageForUpload,
  unreadablePhotoMessage,
} from "@/lib/image-resize";

const MAX_IMAGES = 8;
const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

type PhotoImage = { id: string; storagePath: string; url: string };

/** "1 zdjęcie", "3 zdjęcia", "5 zdjęć" — Polish plural, as seatsLabel does for seats. */
function photosLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) return "1 zdjęcie";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} zdjęcia`;
  return `${count} zdjęć`;
}

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

    startTransition(async () => {
      try {
        // Opened before anything is uploaded: a HEIC photo this browser
        // cannot decode is refused with how to send a JPG. Size is not
        // checked on the original — it is downscaled before upload.
        setStatus("Sprawdzamy zdjęcia…");
        for (const file of files) {
          const problem = await checkPhotoFile(file);
          if (problem) {
            setError(problem);
            return;
          }
        }

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
          setStatus(`Wgrywanie zdjęcia „${file.name}”…`);
          let image: File;
          try {
            image = await resizeImageForUpload(file);
          } catch (err) {
            console.error("photo manager: could not prepare a photo", err);
            setError(unreadablePhotoMessage(file));
            return;
          }
          if (image.size > MAX_UPLOAD_IMAGE_BYTES) {
            setError(`Zdjęcie „${file.name}” jest za duże nawet po zmniejszeniu — wybierz inne.`);
            return;
          }
          const path = `${user.id}/${carId}/${crypto.randomUUID()}.${fileExtension(image)}`;

          const { error: uploadError } = await supabase.storage
            .from("car-images")
            .upload(path, image, { contentType: image.type });

          if (uploadError) {
            console.error("photo manager: upload failed", uploadError);
            setError("Nie udało się wgrać zdjęcia — sprawdź połączenie z internetem i spróbuj ponownie.");
            return;
          }

          const position = nextPosition++;
          const result = await addCarPhoto(carId, path, position);
          if (!result || result.error) {
            // A refused or unanswered save never created the row, so the
            // file it was for is only clutter in Storage.
            if (result?.error) await supabase.storage.from("car-images").remove([path]);
            setError(result?.error ?? CONNECTION_FAILED);
            return;
          }

          const { data: publicUrl } = supabase.storage.from("car-images").getPublicUrl(path);
          setPhotos((prev) => [
            ...prev,
            { id: result.imageId ?? path, storagePath: path, url: publicUrl.publicUrl },
          ]);
        }
      } catch (err) {
        // Without this a dropped connection rethrows into Next's bare
        // "Application error" screen.
        console.error("photo manager", err);
        setError(CONNECTION_FAILED);
      } finally {
        setStatus(null);
      }
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
      try {
        const result = await removeCarPhoto(carId, photo.id, photo.storagePath);
        if (!result || result.error) {
          setError(result?.error ?? CONNECTION_FAILED);
        } else {
          setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
        }
      } catch (err) {
        console.error("photo manager: remove failed", err);
        setError(CONNECTION_FAILED);
      } finally {
        setRemovingId(null);
      }
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
                // Hidden until hover only where hover exists: on a touch
                // screen there is no hover, and the button was invisible yet
                // still deleted the photo when the corner was tapped.
                className="absolute right-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white transition-opacity focus-visible:opacity-100 disabled:opacity-50 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
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
            Możesz dodać jeszcze {photosLabel(MAX_IMAGES - photos.length)} (zmniejszamy je
            automatycznie).
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
