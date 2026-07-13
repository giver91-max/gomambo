"use client";

import { useFormState } from "react-dom";
import { updateCarDetails, type EditCarState } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import type { Car } from "@/types/database";

const initialState: EditCarState = { error: null };

export function EditCarForm({ car }: { car: Car }) {
  const updateWithId = updateCarDetails.bind(null, car.id);
  const [state, formAction] = useFormState(updateWithId, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="brand">Marka</Label>
          <Input id="brand" name="brand" required defaultValue={car.brand} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" required defaultValue={car.model} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="year">Rok produkcji</Label>
          <Input
            id="year"
            name="year"
            type="number"
            required
            min={1990}
            max={new Date().getFullYear() + 1}
            defaultValue={car.year}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price_per_day">Cena / dzień (zł)</Label>
          <Input
            id="price_per_day"
            name="price_per_day"
            type="number"
            step="0.01"
            min={1}
            required
            defaultValue={car.price_per_day}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="city">Miasto</Label>
        <Input id="city" name="city" required defaultValue={car.city} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="registration_number">Numer rejestracyjny</Label>
        <Input
          id="registration_number"
          name="registration_number"
          required
          defaultValue={car.registration_number ?? ""}
          placeholder="WX 12345"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Opis (opcjonalnie)</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={car.description ?? ""}
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && !state.error && (
        <p className="text-sm text-muted-foreground">Zapisano zmiany.</p>
      )}

      <SubmitButton>Zapisz zmiany</SubmitButton>
    </form>
  );
}
