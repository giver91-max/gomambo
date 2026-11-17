"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatPriceZl, wholeZl } from "@/lib/money-format";

const SCENARIOS = [
  { days: 8, label: "Okazjonalnie" },
  { days: 15, label: "Regularnie" },
  { days: 22, label: "Często" },
];

export function EarningsCalculator() {
  const [pricePerDay, setPricePerDay] = useState(120);

  return (
    <div className="space-y-6">
      <div className="max-w-xs space-y-2">
        <Label htmlFor="pricePerDay">Twoja cena za dzień (zł)</Label>
        {/* Prices on GoMambo are whole złoty. step alone does not stop a
            typed "120,5" — the browser only flags it invalid and still hands
            it over — so the value is rounded here, and the totals below can
            never show grosze. */}
        <Input
          id="pricePerDay"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={pricePerDay}
          onChange={(e) => setPricePerDay(Math.max(0, wholeZl(e.target.value)))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {SCENARIOS.map((s) => (
          <div key={s.days} className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              {s.label} · {s.days} dni/mies.
            </p>
            <p className="mt-1 text-2xl font-bold">
              {formatPriceZl(pricePerDay * s.days)}
            </p>
            <p className="text-xs text-muted-foreground">szacunkowo / miesiąc</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        To orientacyjne wyliczenie na podstawie podanej przez Ciebie ceny — nie
        uwzględnia kosztów eksploatacji auta. Rzeczywisty przychód zależy od
        popytu w Twojej okolicy.
      </p>
    </div>
  );
}
