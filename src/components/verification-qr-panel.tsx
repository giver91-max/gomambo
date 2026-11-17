"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { createClient } from "@/lib/supabase/client";
import { createVerificationHandoff } from "@/app/dashboard/profile/verification-handoff-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import type { IdentityVerificationHandoff } from "@/types/database";

type Session = { id: string; token: string; url: string; expiresAt: string };

type HandoffSnapshot = Pick<
  IdentityVerificationHandoff,
  | "status"
  | "document_front_uploaded_at"
  | "document_back_uploaded_at"
  | "selfie_uploaded_at"
  | "handoff_expires_at"
  | "result_identity_verification_id"
>;

const SNAPSHOT_COLUMNS =
  "status, document_front_uploaded_at, document_back_uploaded_at, selfie_uploaded_at, handoff_expires_at, result_identity_verification_id";

// Sessions that can never move again. 'completed' is not one of them: after
// an inconclusive result the phone offers "Spróbuj jeszcze raz", which
// reopens the session for another selfie and finishes it a second time.
const CLOSED = ["expired", "cancelled"];

/**
 * The phone finished AND its verification is saved. finalizeHandoff marks the
 * session 'completed' first (to claim it) and links the saved verification
 * only afterwards — refreshing on the bare status would re-render the profile
 * before the new result exists.
 */
function isFinished(row: HandoffSnapshot | null): boolean {
  return row?.status === "completed" && !!row.result_identity_verification_id;
}

// Realtime is the fast path, not the only one: a dropped websocket, a
// blocked connection or a sleeping laptop tab would otherwise leave the
// desktop showing a dead QR code after the phone had finished.
const POLL_MS = 5000;

// A session the phone claimed for saving but never linked to a result for
// this long was left behind by a finalize that failed half-way — the same
// window after which the server gives up on it (STALE_HANDOFF_CLAIM_MS in
// lib/verification-handoff.ts, which this client file cannot import). Timed
// from when this page first saw the claim, so a wrong clock on the computer
// cannot cut it short.
const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * True on a device whose main pointer is a finger. There the QR code is
 * useless — nobody can scan their own screen — so the panel leads with a
 * link that opens the phone flow right here instead.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(pointer: coarse)");
    setCoarse(query.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return coarse;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export function VerificationQrPanel({
  replaceApproved = false,
}: {
  /** Sent with the session request when an approved account explicitly chose to replace its documents. */
  replaceApproved?: boolean;
}) {
  const router = useRouter();
  const isTouch = useCoarsePointer();
  const [session, setSession] = useState<Session | null>(null);
  const [handoff, setHandoff] = useState<HandoffSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // When this page first saw the phone's claim without a result yet.
  const [claimSeenAt, setClaimSeenAt] = useState<number | null>(null);

  const expiresAt = handoff?.handoff_expires_at ?? session?.expiresAt ?? null;
  // The phone marks a session expired only when it next talks to the
  // server, so the desktop works it out from the deadline itself.
  const inactive =
    !!session &&
    handoff?.status !== "completed" &&
    (handoff?.status === "expired" ||
      handoff?.status === "cancelled" ||
      (expiresAt !== null && new Date(expiresAt).getTime() <= now));

  useEffect(() => {
    if (!session) return;

    const supabase = createClient();
    let stopped = false;
    // Set on cleanup: a poll still in flight for the previous session must
    // not paint its (cancelled) row over a freshly generated code.
    let disposed = false;
    let deadline = new Date(session.expiresAt).getTime();
    let wasFinished = false;

    const apply = (row: HandoffSnapshot) => {
      if (disposed) return;
      setHandoff(row);
      const claimedUnsaved = row.status === "completed" && !row.result_identity_verification_id;
      setClaimSeenAt((seen) => (claimedUnsaved ? (seen ?? Date.now()) : null));
      deadline = new Date(row.handoff_expires_at).getTime();
      // Worked out from every row rather than latched: a retake reopens a
      // finished session and pushes its deadline out, and polling must pick
      // up again if realtime is what brought that news.
      stopped = CLOSED.includes(row.status) || Date.now() > deadline;
      // Every time the phone finishes — a retake after an inconclusive
      // result finishes the same session again — not just the first.
      const finished = isFinished(row);
      if (finished && !wasFinished) {
        // Re-renders the profile with the saved verification; the manager
        // picks the new status up from its props (and, once approved, stops
        // showing this panel at all).
        router.refresh();
      }
      wasFinished = finished;
    };

    const channel = supabase
      .channel(`handoff-${session.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "identity_verification_handoffs", filter: `id=eq.${session.id}` },
        (payload) => apply(payload.new as HandoffSnapshot)
      )
      .subscribe();

    // Polling goes on after the phone finishes, until the session's deadline:
    // a retake reopens it, and a desktop whose realtime socket has dropped
    // would otherwise never see the second result.
    const poll = window.setInterval(async () => {
      if (stopped) return;
      // Past the deadline nothing can extend it any more (the server marks
      // the session expired on its next read), so this is the last look.
      if (Date.now() > deadline) stopped = true;
      const { data } = await supabase
        .from("identity_verification_handoffs")
        .select(SNAPSHOT_COLUMNS)
        .eq("id", session.id)
        .maybeSingle();
      if (data) apply(data as HandoffSnapshot);
    }, POLL_MS);

    // Keeps the "ważny do" / "wygasł" state honest without a server round trip.
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);

    return () => {
      stopped = true;
      disposed = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router is stable, re-subscribing on it would be wasteful
  }, [session]);

  async function handleStart() {
    setError(null);
    setIsStarting(true);
    try {
      const result = await createVerificationHandoff({ replaceApproved });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNow(Date.now());
      setHandoff(null);
      setClaimSeenAt(null);
      setSession(result);
    } catch {
      setError("Nie udało się utworzyć sesji. Sprawdź połączenie i spróbuj ponownie.");
    } finally {
      setIsStarting(false);
    }
  }

  // A new code closes the current session and deletes the photos taken in
  // it, so ask first when there is something to lose.
  function handleNewCode() {
    const progress =
      handoff?.document_front_uploaded_at ||
      handoff?.document_back_uploaded_at ||
      handoff?.selfie_uploaded_at;
    if (
      progress &&
      !inactive &&
      !confirm("Zdjęcia zrobione telefonem w tej sesji przepadną. Wygenerować nowy kod?")
    ) {
      return;
    }
    handleStart();
  }

  if (!session) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" disabled={isStarting} onClick={handleStart}>
          {isStarting
            ? "Tworzenie sesji…"
            : isTouch
              ? "Zrób zdjęcia aparatem krok po kroku"
              : "Zweryfikuj przez telefon (QR)"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (isFinished(handoff)) {
    return <p className="text-sm text-muted-foreground">Weryfikacja przez telefon zakończona ✓</p>;
  }

  if (handoff?.status === "completed") {
    // Saving takes seconds. This long without a result, the save on the phone
    // broke off: without a way on the panel would wait here for ever.
    if (claimSeenAt !== null && now - claimSeenAt >= STALE_CLAIM_MS) {
      return (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-sm">
            Nie dostaliśmy jeszcze wyniku z telefonu. Odśwież stronę, żeby sprawdzić status
            weryfikacji, albo wygeneruj nowy kod i zrób zdjęcia jeszcze raz.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={isStarting} onClick={handleStart}>
            {isStarting ? "Tworzenie sesji…" : "Wygeneruj nowy kod"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Telefon przesłał zdjęcia — zapisujemy wynik weryfikacji…</p>;
  }

  if (inactive) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        {/* A closed session is usually the form above at work — its
            "Wysłane ✓" sits right above this — so it does not urge a new
            code as if the verification were still unfinished. */}
        <p className="text-sm">
          {handoff?.status === "cancelled"
            ? "Ten kod nie jest już aktywny — utworzono nowszy albo zdjęcia wysłano z formularza powyżej. Nowy kod jest potrzebny tylko, jeśli chcesz zrobić zdjęcia telefonem jeszcze raz."
            : "Kod wygasł. Wygeneruj nowy, żeby dokończyć weryfikację telefonem."}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={isStarting} onClick={handleStart}>
          {isStarting ? "Tworzenie sesji…" : "Wygeneruj nowy kod"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  const steps: { label: string; done: boolean }[] = [
    {
      label: isTouch ? "Otwórz link i potwierdź kod z e-maila" : "Zeskanuj kod i potwierdź kod z e-maila",
      done: handoff?.status === "claimed" || handoff?.status === "photos_uploaded",
    },
    { label: "Zdjęcie przodu prawa jazdy", done: !!handoff?.document_front_uploaded_at },
    { label: "Zdjęcie tyłu prawa jazdy", done: !!handoff?.document_back_uploaded_at },
    { label: "Selfie", done: !!handoff?.selfie_uploaded_at },
  ];

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">
        {isTouch
          ? "Otwórz weryfikację na tym telefonie i zrób zdjęcia aparatem"
          : "Zeskanuj kod telefonem, żeby dokończyć weryfikację"}
      </p>
      {isTouch && (
        <a
          href={session.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          Otwórz na tym telefonie →
        </a>
      )}
      <div className="bg-white p-3 w-fit rounded">
        <QRCode value={session.url} size={160} />
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {isTouch ? "Albo zeskanuj kod innym telefonem. Link: " : "Albo otwórz na telefonie: "}
        <a href={session.url} target="_blank" rel="noopener noreferrer" className="underline">
          {session.url}
        </a>
      </p>
      {expiresAt && (
        <p className="text-xs text-muted-foreground">
          Kod ważny do {formatTime(expiresAt)} — każdy kolejny krok na telefonie go przedłuża.
        </p>
      )}
      <ul className="space-y-1 text-sm">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? "text-foreground" : "text-muted-foreground"}>
            {step.done ? "✓" : "○"} {step.label}
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" size="sm" disabled={isStarting} onClick={handleNewCode}>
        {isStarting ? "Tworzenie sesji…" : "Nowy kod"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
