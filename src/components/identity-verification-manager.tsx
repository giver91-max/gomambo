"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitIdentityVerification } from "@/app/dashboard/profile/identity-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelfieCapture } from "@/components/selfie-capture";
import { VerificationQrPanel } from "@/components/verification-qr-panel";
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
  initialSelfieUrl,
}: {
  userId: string;
  initialStatus: IdentityVerificationStatus | null;
  initialRejectionReason: string | null;
  initialDocumentUrl: string | null;
  initialSelfieUrl: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [rejectionReason, setRejectionReason] = useState(initialRejectionReason);
  const [documentUrl, setDocumentUrl] = useState(initialDocumentUrl);
  const [selfieUrl, setSelfieUrl] = useState(initialSelfieUrl);
  const [pendingDocument, setPendingDocument] = useState<File | null>(null);
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

    setPendingDocument(file);
  }

  function finish(documentFile: File, selfieBlob: Blob | null) {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const ext = documentFile.name.split(".").pop() || "jpg";
      const documentPath = `${userId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("id-documents")
        .upload(documentPath, documentFile, { contentType: documentFile.type });

      if (uploadError) {
        setError(`Błąd wgrywania dokumentu: ${uploadError.message}`);
        setPendingDocument(null);
        return;
      }

      let selfiePath: string | null = null;
      if (selfieBlob) {
        selfiePath = `${userId}/${crypto.randomUUID()}-selfie.jpg`;
        const { error: selfieUploadError } = await supabase.storage
          .from("id-documents")
          .upload(selfiePath, selfieBlob, { contentType: "image/jpeg" });
        if (selfieUploadError) {
          setError(`Błąd wgrywania selfie: ${selfieUploadError.message}`);
          setPendingDocument(null);
          return;
        }
      }

      const result = await submitIdentityVerification(documentPath, selfiePath);
      if (result.error) {
        setError(result.error);
        setPendingDocument(null);
        return;
      }

      const { data: signedDoc } = await supabase.storage
        .from("id-documents")
        .createSignedUrl(documentPath, 60 * 5);
      setDocumentUrl(signedDoc?.signedUrl ?? null);

      if (selfiePath) {
        const { data: signedSelfie } = await supabase.storage
          .from("id-documents")
          .createSignedUrl(selfiePath, 60 * 5);
        setSelfieUrl(signedSelfie?.signedUrl ?? null);
      } else {
        setSelfieUrl(null);
      }

      setStatus("pending");
      setRejectionReason(null);
      setPendingDocument(null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Dodaj zdjęcie dowodu osobistego lub prawa jazdy oraz zrób selfie na żywo. Dokumenty widzi
        tylko nasz zespół podczas weryfikacji.
      </p>

      {status && <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>}

      {status === "rejected" && rejectionReason && (
        <p className="text-sm text-destructive">Powód odrzucenia: {rejectionReason}</p>
      )}

      <div className="flex flex-wrap gap-3">
        {documentUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
          <img
            src={documentUrl}
            alt="Wgrany dokument"
            className="max-h-48 rounded-lg border object-contain"
          />
        )}
        {selfieUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't proxy it usefully
          <img
            src={selfieUrl}
            alt="Wgrane selfie"
            className="max-h-48 rounded-lg border object-contain"
          />
        )}
      </div>

      {!pendingDocument && (
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
      )}

      {pendingDocument && !isPending && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Krok 2: zrób selfie</p>
          <SelfieCapture
            onConfirm={(blob) => finish(pendingDocument, blob)}
            onSkip={() => finish(pendingDocument, null)}
            isSubmitting={isPending}
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!pendingDocument && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            Wolisz zrobić zdjęcia telefonem? Zeskanuj kod QR — dostaniesz zdjęcia przodu, tyłu i
            selfie w jednym kroku, z automatycznym porównaniem.
          </p>
          <VerificationQrPanel />
        </div>
      )}
    </div>
  );
}
