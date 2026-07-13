"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitIdentityVerification } from "@/app/dashboard/profile/identity-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IdentityVerificationStatus } from "@/types/database";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

const statusLabel: Record<IdentityVerificationStatus, string> = {
  pending: "Oczekuje na weryfikację",
  approved: "Zweryfikowano",
  rejected: "Odrzucono",
};

const statusVariant: Record<IdentityVerificationStatus, "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function IdentityVerificationManager({
  userId,
  initialStatus,
  initialRejectionReason,
  initialDocumentUrl,
}: {
  userId: string;
  initialStatus: IdentityVerificationStatus | null;
  initialRejectionReason: string | null;
  initialDocumentUrl: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [rejectionReason, setRejectionReason] = useState(initialRejectionReason);
  const [documentUrl, setDocumentUrl] = useState(initialDocumentUrl);
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
    if (file.size > MAX_FILE_BYTES) {
      setError("Plik przekracza 8 MB.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("id-documents")
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        setError(`Błąd wgrywania pliku: ${uploadError.message}`);
        return;
      }

      const result = await submitIdentityVerification(path);
      if (result.error) {
        setError(result.error);
        return;
      }

      const { data: signed } = await supabase.storage
        .from("id-documents")
        .createSignedUrl(path, 60 * 5);
      setDocumentUrl(signed?.signedUrl ?? null);
      setStatus("pending");
      setRejectionReason(null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Dodaj zdjęcie dowodu osobistego lub prawa jazdy. Dokument widzi tylko nasz zespół podczas
        weryfikacji.
      </p>

      {status && <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>}

      {status === "rejected" && rejectionReason && (
        <p className="text-sm text-destructive">Powód odrzucenia: {rejectionReason}</p>
      )}

      {documentUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
        <img
          src={documentUrl}
          alt="Wgrany dokument"
          className="max-h-48 rounded-lg border object-contain"
        />
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {isPending ? "Wgrywanie…" : documentUrl ? "Wgraj nowy dokument" : "Wgraj dokument"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
