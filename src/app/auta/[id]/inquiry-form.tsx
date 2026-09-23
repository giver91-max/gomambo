"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendInquiry, type InquiryState } from "./inquiry-actions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getRecaptchaToken } from "@/lib/recaptcha-client";
import type { SelectedRange } from "./availability-view";
import { applyCommission, calculateBookingPrice } from "@/lib/pricing";
import { VerificationRequiredNotice } from "@/components/verification-required-notice";
import type { RentalParty } from "@/components/rental-liability-notice";
import type { IdentityVerificationStatus } from "@/types/database";

const initialState: InquiryState = { error: null };

export function InquiryForm({
  carId,
  selectedRange,
  isLoggedIn,
  verificationStatus,
  verificationRejectionReason,
  pricePerDay,
  pricePerMonth,
  commissionRate,
  party,
}: {
  carId: string;
  selectedRange?: SelectedRange;
  isLoggedIn: boolean;
  verificationStatus: IdentityVerificationStatus | null;
  verificationRejectionReason: string | null;
  pricePerDay: number;
  pricePerMonth: number | null;
  commissionRate: number;
  party: RentalParty;
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

  if (verificationStatus !== "approved") {
    return (
      <VerificationRequiredNotice
        status={verificationStatus}
        rejectionReason={verificationRejectionReason}
      />
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
              const { nights, useMonthly, total } = calculateBookingPrice(
                pricePerDay,
                pricePerMonth,
                selectedRange.start,
                selectedRange.end
              );
              const { commission, gross } = applyCommission(total, commissionRate);
              return (
                <div className="space-y-1 rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground">
                    {nights} {nights === 1 ? "dzień" : "dni"}
                    {useMonthly ? " · stawka miesięczna" : ""}
                  </p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Wynajem</span>
                    <span>{total.toFixed(2)} zł</span>
                  </div>
                  {commission > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Opłata serwisowa GoMambo</span>
                      <span>{commission.toFixed(2)} zł</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-1 font-semibold text-foreground">
                    <span>Razem</span>
                    <span>{gross.toFixed(2)} zł</span>
                  </div>
                </div>
              );
            })()}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Zaznacz w kalendarzu termin, o który chcesz zapytać.
        </p>
      )}


      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-destructive/40 p-3 text-sm">
        <input
          type="checkbox"
          name="insuranceAck"
          required
          className="mt-0.5 size-4 shrink-0 accent-[var(--destructive)]"
        />
        <span>
          Rozumiem, że umowę najmu zawieram bezpośrednio z wynajmującym —{" "}
          <strong>{party.partnerName ?? party.ownerName}</strong> — a GoMambo prowadzi platformę i
          nie jest ubezpieczycielem. Wiem, że{" "}
          <strong>obowiązkowe OC nie pokrywa uszkodzeń wynajmowanego auta</strong> i że za auto w
          czasie wynajmu odpowiadam na zasadach umowy najmu.
        </span>
      </label>

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
