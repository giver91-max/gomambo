"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setCarInsuranceDocument } from "./actions";
import { Button } from "@/components/ui/button";
import { fileExtension, prepareDocumentFile } from "@/lib/image-resize";

const MAX_INSURANCE_BYTES = 8 * 1024 * 1024;
const CONNECTION_FAILED =
  "Nie udało się połączyć z GoMambo — sprawdź internet i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

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

    startTransition(async () => {
      try {
        // A phone photo over the limit, or a HEIC one other browsers cannot
        // show, is re-encoded as a JPEG instead of being refused.
        const prepared = await prepareDocumentFile(file, MAX_INSURANCE_BYTES);
        if (prepared.error !== undefined) {
          setError(prepared.error);
          return;
        }
        const upload = prepared.file;
        const uploadIsPdf = upload.type === "application/pdf" || /\.pdf$/i.test(upload.name);

        const supabase = createClient();
        const path = `${ownerId}/${carId}/${crypto.randomUUID()}.${fileExtension(upload, uploadIsPdf ? "pdf" : "jpg")}`;

        const { error: uploadError } = await supabase.storage
          .from("car-insurance")
          .upload(path, upload, { contentType: upload.type || undefined });

        if (uploadError) {
          console.error("insurance manager: upload failed", uploadError);
          setError("Nie udało się wgrać pliku — sprawdź połączenie z internetem i spróbuj ponownie.");
          return;
        }

        const result = await setCarInsuranceDocument(carId, path);
        if (!result || result.error) {
          // A refused save never pointed the car at this file.
          if (result?.error) await supabase.storage.from("car-insurance").remove([path]);
          setError(result?.error ?? CONNECTION_FAILED);
          return;
        }

        const { data: signed } = await supabase.storage
          .from("car-insurance")
          .createSignedUrl(path, 60 * 5);
        setUrl(signed?.signedUrl ?? null);
        setIsPdf(uploadIsPdf);
      } catch (err) {
        // Without this a dropped connection rethrows into Next's bare
        // "Application error" screen.
        console.error("insurance manager", err);
        setError(CONNECTION_FAILED);
      }
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
