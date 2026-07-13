"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendInquiry, type InquiryState } from "./inquiry-actions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getRecaptchaToken } from "@/lib/recaptcha-client";
import type { SelectedRange } from "./availability-view";
import { eachDateInRange } from "@/lib/calendar";

const initialState: InquiryState = { error: null };
const MONTHLY_THRESHOLD_NIGHTS = 28;

export function InquiryForm({
  carId,
  selectedRange,
  isLoggedIn,
  pricePerDay,
  pricePerMonth,
}: {
  carId: string;
  selectedRange?: SelectedRange;
  isLoggedIn: boolean;
  pricePerDay: number;
  pricePerMonth: number | null;
}) {
  const [state, setState] = useState<InquiryState>(initialState);
  const [isPending, startTransition] = useTransition();

  if (!isLoggedIn) {
    return (
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p>Zaloguj się, aby zapytać o wynajem tego auta.</p>
        <Button render={<Link href={`/login?redirect=/auta/${carId}`} />}>
          Zaloguj się
        </Button>
      </div>
    );
  }

  if (state.success) {
    return (
      <p className="text-sm text-muted-foreground">
        Zapytanie zostało wysłane do właściciela. Odpowiedź znajdziesz w skrzynce
        wiadomości.
      </p>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const token = await getRecaptchaToken("inquiry");
      formData.set("recaptchaToken", token ?? "");
      const result = await sendInquiry(initialState, formData);
      setState(result);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input type="hidden" name="carId" value={carId} />
      <input type="hidden" name="rangeStart" value={selectedRange?.start ?? ""} />
      <input type="hidden" name="rangeEnd" value={selectedRange?.end ?? ""} />
      <input
        type="text"
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      {selectedRange?.start ? (
        <div className="space-y-1">
          <p className="text-sm">
            Wybrany termin: <strong>{selectedRange.start}</strong>
            {selectedRange.end ? (
              <>
                {" "}
                – <strong>{selectedRange.end}</strong>
              </>
            ) : (
              " (kliknij drugi dzień, aby zaznaczyć koniec terminu)"
            )}
          </p>
          {selectedRange.end &&
            (() => {
              const nights = eachDateInRange(selectedRange.start, selectedRange.end).length;
              const useMonthly = pricePerMonth !== null && nights >= MONTHLY_THRESHOLD_NIGHTS;
              const months = useMonthly ? Math.round((nights / 30) * 10) / 10 : null;
              const estimatedTotal = useMonthly
                ? (pricePerMonth as number) * (months as number)
                : pricePerDay * nights;
              return (
                <p className="text-sm text-muted-foreground">
                  {nights} {nights === 1 ? "dzień" : "dni"}
                  {useMonthly ? " · stawka miesięczna" : ""} — szacunkowo{" "}
                  <strong className="text-foreground">{estimatedTotal.toFixed(2)} zł</strong>
                </p>
              );
            })()}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Zaznacz w kalendarzu termin, o który chcesz zapytać.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="message">Wiadomość</Label>
        <Textarea
          id="message"
          name="message"
          rows={4}
          required
          placeholder="Np. dodatkowe pytania dotyczące wynajmu."
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button
        type="submit"
        className="w-full"
        disabled={isPending || !selectedRange?.start || !selectedRange?.end}
      >
        {isPending ? "Chwileczkę…" : "Zapytaj o wynajem"}
      </Button>
    </form>
  );
}
