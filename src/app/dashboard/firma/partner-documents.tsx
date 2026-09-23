"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { addPartnerDocument } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const KINDS: { value: string; label: string }[] = [
  { value: "krs", label: "Odpis z KRS" },
  { value: "ceidg", label: "Wydruk z CEIDG" },
  { value: "nip_confirmation", label: "Potwierdzenie NIP" },
  { value: "insurance", label: "Polisa floty" },
  { value: "other", label: "Inny dokument" },
];

const MAX_BYTES = 10 * 1024 * 1024;

export function PartnerDocuments({
  partnerId,
  documents,
}: {
  partnerId: string;
  documents: { id: string; kind: string; originalName: string | null; verifiedAt: string | null }[];
}) {
  const [kind, setKind] = useState("krs");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("Plik przekracza 10 MB.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "pdf";
      // Keyed on the PARTNER, not the uploader — the document belongs to the
      // company and every member of it must be able to read it.
      const path = `${partnerId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("partner-documents")
        .upload(path, file, { contentType: file.type });
      if (uploadError) {
        setError(`Nie udało się wgrać pliku: ${uploadError.message}`);
        return;
      }
      const result = await addPartnerDocument(kind, path, file.name);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dokumenty firmy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Potrzebujemy odpisu z KRS albo wydruku z CEIDG, żeby potwierdzić, że firma istnieje i że
          działasz w jej imieniu. Polisę floty możesz dołączyć od razu — przyspieszy to weryfikację
          aut.
        </p>

        {documents.length > 0 && (
          <ul className="space-y-1">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 border-b py-1">
                <span className="text-foreground">
                  {KINDS.find((k) => k.value === doc.kind)?.label ?? doc.kind}
                  {doc.originalName ? ` — ${doc.originalName}` : ""}
                </span>
                <Badge variant={doc.verifiedAt ? "default" : "secondary"}>
                  {doc.verifiedAt ? "Zweryfikowany" : "Czeka"}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border bg-background p-2 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => fileRef.current?.click()}
          >
            {isPending ? "Wgrywanie…" : "Wgraj dokument"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
