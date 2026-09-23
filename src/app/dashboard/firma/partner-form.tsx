"use client";

import { useFormState } from "react-dom";
import { savePartner } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/submit-button";

type Initial = {
  trade_name: string;
  city: string;
  description: string;
  legal_name: string;
  nip: string;
  regon: string;
  krs: string;
  address_street: string;
  address_postal_code: string;
  address_city: string;
  contact_email: string;
  contact_phone: string;
};

export function PartnerForm({ initial, isNew }: { initial: Initial; isNew: boolean }) {
  const [state, formAction] = useFormState(savePartner, {
    error: null as string | null,
  });

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isNew ? "Zgłoś wypożyczalnię" : "Dane firmy"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="trade_name">Nazwa widoczna dla klientów *</Label>
            <Input
              id="trade_name"
              name="trade_name"
              required
              defaultValue={initial.trade_name}
              placeholder="np. AutoPrestiż Katowice"
            />
            <p className="text-xs text-muted-foreground">
              Tę nazwę zobaczy klient przy każdym Waszym aucie.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="legal_name">Pełna nazwa firmy *</Label>
              <Input id="legal_name" name="legal_name" required defaultValue={initial.legal_name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nip">NIP *</Label>
              <Input id="nip" name="nip" required defaultValue={initial.nip} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="regon">REGON</Label>
              <Input id="regon" name="regon" defaultValue={initial.regon} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="krs">KRS (jeśli dotyczy)</Label>
              <Input id="krs" name="krs" defaultValue={initial.krs} inputMode="numeric" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address_street">Ulica i numer</Label>
              <Input id="address_street" name="address_street" defaultValue={initial.address_street} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address_postal_code">Kod pocztowy</Label>
              <Input
                id="address_postal_code"
                name="address_postal_code"
                defaultValue={initial.address_postal_code}
                placeholder="00-000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address_city">Miejscowość</Label>
              <Input id="address_city" name="address_city" defaultValue={initial.address_city} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact_email">E-mail do kontaktu *</Label>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                required
                defaultValue={initial.contact_email}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact_phone">Telefon</Label>
              <Input id="contact_phone" name="contact_phone" defaultValue={initial.contact_phone} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="city">Miasto działalności (widoczne publicznie)</Label>
            <Input id="city" name="city" defaultValue={initial.city} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Krótki opis (widoczny publicznie)</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              maxLength={600}
              defaultValue={initial.description}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="Od 2015 roku wynajmujemy auta w Katowicach i okolicach. Flota do 3 lat, pełne OC/AC."
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Dane rejestrowe firmy widzi wyłącznie GoMambo. Klient zobaczy nazwę, miasto, opis i
            logo — nigdy NIP-u ani adresu siedziby.
          </p>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.success && (
            <p className="text-sm text-primary">Zapisane. Dziękujemy — odezwiemy się po weryfikacji.</p>
          )}

          <SubmitButton>{isNew ? "Zgłoś wypożyczalnię" : "Zapisz zmiany"}</SubmitButton>
        </CardContent>
      </Card>
    </form>
  );
}
