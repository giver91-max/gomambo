"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setAvatar, removeAvatar } from "@/app/dashboard/profile/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function AvatarManager({
  userId,
  initialUrl,
  fallbackLabel,
}: {
  userId: string;
  initialUrl: string | null;
  fallbackLabel: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Plik musi być zdjęciem.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Zdjęcie przekracza 5 MB.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        setError(`Błąd wgrywania zdjęcia: ${uploadError.message}`);
        return;
      }

      const result = await setAvatar(path);
      if (result.error) {
        setError(result.error);
        return;
      }

      const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(path);
      setUrl(publicUrl.publicUrl);
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeAvatar();
      if (result.error) {
        setError(result.error);
        return;
      }
      setUrl(null);
    });
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar size="lg" className="size-16">
        <AvatarImage src={url ?? undefined} alt="Zdjęcie profilowe" />
        <AvatarFallback className="text-base">{fallbackLabel}</AvatarFallback>
      </Avatar>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {url ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemove}>
              Usuń
            </Button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
