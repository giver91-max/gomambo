"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { updateCarDetails, type EditCarState } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import {
  CANCELLATION_POLICY_DESCRIPTIONS,
  CANCELLATION_POLICY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_TYPE_LABELS,
} from "@/lib/car-options";
import type { CancellationPolicy, Car, FuelType, Transmission, VehicleType } from "@/types/database";

const initialState: EditCarState = { error: null };
const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function EditCarForm({ car }: { car: Car }) {
  const updateWithId = updateCarDetails.bind(null, car.id);
  const [state, formAction] = useFormState(updateWithId, initialState);
  const [deliveryAvailable, setDeliveryAvailable] = useState(car.delivery_available);

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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="vehicle_type">Typ pojazdu</Label>
          <select
            id="vehicle_type"
            name="vehicle_type"
            required
            defaultValue={car.vehicle_type ?? ""}
            className={selectClassName}
          >
            <option value="" disabled>
              Wybierz typ
            </option>
            {(Object.entries(VEHICLE_TYPE_LABELS) as [VehicleType, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fuel_type">Rodzaj paliwa</Label>
          <select
            id="fuel_type"
            name="fuel_type"
            required
            defaultValue={car.fuel_type ?? ""}
            className={selectClassName}
          >
            <option value="" disabled>
              Wybierz paliwo
            </option>
            {(Object.entries(FUEL_TYPE_LABELS) as [FuelType, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="transmission">Skrzynia biegów</Label>
          <select
            id="transmission"
            name="transmission"
            required
            defaultValue={car.transmission ?? ""}
            className={selectClassName}
          >
            <option value="" disabled>
              Wybierz skrzynię
            </option>
            {(Object.entries(TRANSMISSION_LABELS) as [Transmission, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="seats">Liczba miejsc</Label>
          <Input
            id="seats"
            name="seats"
            type="number"
            min={1}
            max={9}
            required
            defaultValue={car.seats ?? ""}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mileage_limit_km">Limit km / dzień (opcjonalnie)</Label>
          <Input
            id="mileage_limit_km"
            name="mileage_limit_km"
            type="number"
            min={1}
            placeholder="bez limitu"
            defaultValue={car.mileage_limit_km ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price_per_month">Cena / miesiąc (zł, opcjonalnie)</Label>
          <Input
            id="price_per_month"
            name="price_per_month"
            type="number"
            step="0.01"
            min={1}
            placeholder="np. 2400"
            defaultValue={car.price_per_month ?? ""}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="delivery_available"
            value="true"
            checked={deliveryAvailable}
            onChange={(e) => setDeliveryAvailable(e.target.checked)}
            className="size-4"
          />
          Oferuję dowóz auta
        </label>
        {deliveryAvailable && (
          <Input
            name="delivery_info"
            placeholder="np. Dowóz w promieniu 20 km za 50 zł, na lotnisko za 100 zł"
            defaultValue={car.delivery_info ?? ""}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cancellation_policy">Polityka anulowania</Label>
        <select
          id="cancellation_policy"
          name="cancellation_policy"
          defaultValue={car.cancellation_policy}
          className={selectClassName}
        >
          {(Object.entries(CANCELLATION_POLICY_LABELS) as [CancellationPolicy, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label} — {CANCELLATION_POLICY_DESCRIPTIONS[value]}
              </option>
            )
          )}
        </select>
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
