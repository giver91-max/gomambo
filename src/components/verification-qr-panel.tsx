"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { createClient } from "@/lib/supabase/client";
import { createVerificationHandoff } from "@/app/dashboard/profile/verification-handoff-actions";
import { Button } from "@/components/ui/button";
import type { IdentityVerificationHandoff } from "@/types/database";

type Session = { id: string; token: string; url: string };

export function VerificationQrPanel() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [handoff, setHandoff] = useState<Pick<
    IdentityVerificationHandoff,
    | "status"
    | "document_front_uploaded_at"
    | "document_back_uploaded_at"
    | "selfie_uploaded_at"
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!session) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`handoff-${session.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "identity_verification_handoffs", filter: `id=eq.${session.id}` },
        (payload) => {
          const row = payload.new as typeof handoff & { status: string };
          setHandoff(row);
          if (row.status === "completed") {
            router.refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable, re-subscribing on it would be wasteful
  }, [session]);

  async function handleStart() {
    setError(null);
    setIsStarting(true);
    const result = await createVerificationHandoff();
    setIsStarting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSession(result);
    setHandoff(null);
  }

  if (!session) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" disabled={isStarting} onClick={handleStart}>
          {isStarting ? "Tworzenie sesji…" : "Zweryfikuj przez telefon (QR)"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (handoff?.status === "completed") {
    return <p className="text-sm text-muted-foreground">Weryfikacja przez telefon zakończona ✓</p>;
  }

  const steps: { label: string; done: boolean }[] = [
    { label: "Zeskanuj kod i potwierdź kod z e-maila", done: handoff?.status === "claimed" || handoff?.status === "photos_uploaded" },
    { label: "Zdjęcie przodu prawa jazdy", done: !!handoff?.document_front_uploaded_at },
    { label: "Zdjęcie tyłu prawa jazdy", done: !!handoff?.document_back_uploaded_at },
    { label: "Selfie", done: !!handoff?.selfie_uploaded_at },
  ];

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Zeskanuj kod telefonem, żeby dokończyć weryfikację</p>
      <div className="bg-white p-3 w-fit rounded">
        <QRCode value={session.url} size={160} />
      </div>
      <p className="break-all text-xs text-muted-foreground">
        Albo otwórz na telefonie: <span className="underline">{session.url}</span>
      </p>
      <ul className="space-y-1 text-sm">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? "text-foreground" : "text-muted-foreground"}>
            {step.done ? "✓" : "○"} {step.label}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
