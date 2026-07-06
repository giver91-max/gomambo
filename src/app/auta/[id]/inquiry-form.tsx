"use client";

import { useFormState } from "react-dom";
import { sendInquiry, type InquiryState } from "./inquiry-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import type { SelectedRange } from "./availability-view";

const initialState: InquiryState = { error: null };

export function InquiryForm({
  carId,
  selectedRange,
}: {
  carId: string;
  selectedRange?: SelectedRange;
}) {
  const [state, formAction] = useFormState(sendInquiry, initialState);

  if (state.success) {
    return (
      <p className="text-sm text-muted-foreground">
        Wiadomość została wysłana do właściciela. Odpowie bezpośrednio na podany
        przez Ciebie adres e-mail.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
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

      {selectedRange?.start && (
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
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Imię</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Telefon (opcjonalnie)</Label>
        <Input id="phone" name="phone" type="tel" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="message">Wiadomość</Label>
        <Textarea
          id="message"
          name="message"
          rows={4}
          required
          placeholder="Np. terminy, w których chciałbyś wynająć auto."
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <SubmitButton>Zapytaj o dostępność</SubmitButton>
    </form>
  );
}
