"use client";

import { useState, useTransition } from "react";
import { MonthCalendar } from "@/components/month-calendar";
import { addAvailabilityRange, removeAvailabilityRange } from "./actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toISODate, eachDateInRange, getMonthGrid } from "@/lib/calendar";

type Mode = "add" | "remove";
type PendingRange = { from: string; to: string };

const SAVE_FAILED =
  "Nie udało się zapisać zmian — sprawdź połączenie z internetem i spróbuj ponownie. Jeśli błąd się powtarza, odśwież stronę.";

export function AvailabilityEditor({
  carId,
  initialAvailable,
}: {
  carId: string;
  initialAvailable: string[];
}) {
  const [available, setAvailable] = useState(() => new Set(initialAvailable));
  const [isPending, startTransition] = useTransition();
  const [month, setMonth] = useState(() => new Date());
  const [rangeMode, setRangeMode] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const todayIso = toISODate(new Date());

  // The calendar changes at once, but the change is only reported as saved
  // once the server says so; a failed save puts the days back as they were
  // and says why. It used to fire the save and forget it, so a lost
  // connection or an expired session showed days that were never stored.
  function applyRange(from: string, to: string, mode: Mode) {
    const dates = eachDateInRange(from, to);
    const before = new Map(dates.map((d) => [d, available.has(d)]));
    setAvailable((prev) => {
      const next = new Set(prev);
      dates.forEach((d) => (mode === "add" ? next.add(d) : next.delete(d)));
      return next;
    });
    setSaveError(null);
    setSaved(false);
    startTransition(async () => {
      let result: { error: string | null } | undefined;
      try {
        result =
          mode === "add"
            ? await addAvailabilityRange(carId, from, to)
            : await removeAvailabilityRange(carId, from, to);
      } catch (err) {
        console.error("availability editor", err);
      }
      if (result && result.error === null) {
        setSaved(true);
        return;
      }
      setAvailable((prev) => {
        const next = new Set(prev);
        before.forEach((wasAvailable, d) => (wasAvailable ? next.add(d) : next.delete(d)));
        return next;
      });
      setSaveError(result?.error ?? SAVE_FAILED);
    });
  }

  function handleDayClick(iso: string) {
    if (iso < todayIso || pendingRange) return;

    if (!rangeMode) {
      applyRange(iso, iso, available.has(iso) ? "remove" : "add");
      return;
    }

    if (pendingStart === null) {
      setPendingStart(iso);
      return;
    }

    const [from, to] = pendingStart <= iso ? [pendingStart, iso] : [iso, pendingStart];
    setPendingRange({ from, to });
    setPendingStart(null);
  }

  function confirmPendingRange(mode: Mode) {
    if (!pendingRange) return;
    applyRange(pendingRange.from, pendingRange.to, mode);
    setPendingRange(null);
  }

  function cancelPending() {
    setPendingStart(null);
    setPendingRange(null);
  }

  function handleWholeMonth(mode: Mode) {
    const monthDays = getMonthGrid(month).filter((d) => d.inMonth);
    const first = monthDays[0].iso;
    const last = monthDays[monthDays.length - 1].iso;
    const from = first < todayIso ? todayIso : first;
    if (from > last) return;
    applyRange(from, last, mode);
  }

  const selectedRange = pendingRange
    ? { start: pendingRange.from, end: pendingRange.to }
    : pendingStart
      ? { start: pendingStart, end: null }
      : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => {
              setRangeMode(false);
              cancelPending();
            }}
            className={cn(
              "px-3 py-1.5 text-sm",
              !rangeMode ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            Pojedyncze dni
          </button>
          <button
            type="button"
            onClick={() => {
              setRangeMode(true);
              cancelPending();
            }}
            className={cn(
              "px-3 py-1.5 text-sm",
              rangeMode ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            Zakres dat
          </button>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => handleWholeMonth("add")}>
            Zaznacz cały miesiąc
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleWholeMonth("remove")}>
            Odznacz cały miesiąc
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {pendingRange
          ? `Zaznaczono ${pendingRange.from} – ${pendingRange.to}. Co zrobić z tym zakresem?`
          : rangeMode
            ? pendingStart
              ? "Kliknij dzień końcowy zakresu."
              : "Kliknij dzień początkowy zakresu."
            : "Kliknij dzień, aby przełączyć go między dostępnym a niedostępnym."}
        {(pendingStart || pendingRange) && (
          <>
            {" "}
            <button type="button" onClick={cancelPending} className="text-primary hover:underline">
              Anuluj
            </button>
          </>
        )}
      </p>

      {(isPending || saveError || saved) && (
        <p
          aria-live="polite"
          className={cn("text-sm", saveError ? "text-destructive" : "text-muted-foreground")}
        >
          {isPending ? "Zapisywanie…" : saveError ?? "Zapisano."}
        </p>
      )}

      {pendingRange && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => confirmPendingRange("add")} disabled={isPending}>
            Oznacz zakres jako dostępny
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => confirmPendingRange("remove")}
            disabled={isPending}
          >
            Oznacz zakres jako niedostępny
          </Button>
        </div>
      )}

      <div className="max-w-xs">
        <MonthCalendar
          highlightedDates={available}
          selectedRange={selectedRange}
          onDayClick={handleDayClick}
          minDateIso={todayIso}
          month={month}
          onMonthChange={setMonth}
        />
      </div>
    </div>
  );
}
