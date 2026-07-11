"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMonthGrid, addMonths, MONTH_NAMES_PL, WEEKDAY_NAMES_PL } from "@/lib/calendar";

export function MonthCalendar({
  highlightedDates,
  selectedRange,
  onDayClick,
  minDateIso,
  restrictToHighlighted = false,
  month: controlledMonth,
  onMonthChange,
}: {
  highlightedDates: Set<string>;
  selectedRange?: { start: string; end: string | null };
  onDayClick?: (iso: string) => void;
  minDateIso?: string;
  restrictToHighlighted?: boolean;
  month?: Date;
  onMonthChange?: (month: Date) => void;
}) {
  const [internalMonth, setInternalMonth] = useState(() => new Date());
  const month = controlledMonth ?? internalMonth;

  function changeMonth(next: Date) {
    if (onMonthChange) {
      onMonthChange(next);
    } else {
      setInternalMonth(next);
    }
  }

  const days = getMonthGrid(month);

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => changeMonth(addMonths(month, -1))}
        >
          ←
        </Button>
        <p className="text-sm font-medium">
          {MONTH_NAMES_PL[month.getMonth()]} {month.getFullYear()}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => changeMonth(addMonths(month, 1))}
        >
          →
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAY_NAMES_PL.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map(({ date, iso, inMonth }) => {
          const isPast = minDateIso ? iso < minDateIso : false;
          const isHighlighted = highlightedDates.has(iso);
          const isSelected =
            selectedRange?.start === iso ||
            selectedRange?.end === iso ||
            (!!selectedRange?.start &&
              !!selectedRange?.end &&
              iso >= selectedRange.start &&
              iso <= selectedRange.end);
          const isDisabled = isPast || (restrictToHighlighted && !isHighlighted);
          const clickable = !isDisabled && !!onDayClick;

          return (
            <button
              key={iso}
              type="button"
              disabled={!clickable}
              onClick={() => onDayClick?.(iso)}
              className={cn(
                "aspect-square rounded-md text-sm transition-colors",
                !inMonth && "text-muted-foreground/40",
                isHighlighted && !isSelected && "bg-primary/20",
                isSelected && "bg-primary text-primary-foreground",
                isDisabled && "cursor-not-allowed opacity-30",
                clickable && "cursor-pointer hover:bg-muted"
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
