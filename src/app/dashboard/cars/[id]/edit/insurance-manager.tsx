"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setCarInsuranceDocument } from "./actions";
import { Button } from "@/components/ui/button";

const MAX_INSURANCE_BYTES = 8 * 1024 * 1024;

export function InsuranceManager({
  carId,
  ownerId,
  initialUrl,
  initialIsPdf,
}: {
  carId: string;
  ownerId: string;
  initialUrl: string | null;
  initialIsPdf: boolean;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [isPdf, setIsPdf] = useState(initialIsPdf);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);

    const isValidType = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!isValidType) {
      setError("Plik musi być zdjęciem lub PDF-em.");
      return;
    }
    if (file.size > MAX_INSURANCE_BYTES) {
      setError("Plik przekracza 8 MB.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${ownerId}/${carId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("car-insurance")
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        setError(`Błąd wgrywania pliku: ${uploadError.message}`);
        return;
      }

      const result = await setCarInsuranceDocument(carId, path);
      if (result.error) {
        setError(result.error);
        return;
      }

      const { data: signed } = await supabase.storage
        .from("car-insurance")
        .createSignedUrl(path, 60 * 5);
      setUrl(signed?.signedUrl ?? null);
      setIsPdf(file.type === "application/pdf");
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Polisę OC widzi tylko nasz zespół podczas weryfikacji ogłoszenia.
      </p>

      {url &&
        (isPdf ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
            Zobacz wgraną polisę (PDF) →
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
          <img src={url} alt="Polisa OC" className="max-h-48 rounded-lg border object-contain" />
        ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {isPending ? "Wgrywanie…" : url ? "Wgraj nową polisę" : "Wgraj polisę OC"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
