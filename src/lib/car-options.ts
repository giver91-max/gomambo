import type { CancellationPolicy, FuelType, Transmission, VehicleType } from "@/types/database";

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  sedan: "Sedan",
  kombi: "Kombi",
  hatchback: "Hatchback",
  suv: "SUV",
  van: "Van",
  dostawczy: "Dostawczy",
  sportowe: "Sportowe",
  kabriolet: "Kabriolet",
  elektryczne: "Elektryczne",
  inne: "Inne",
};

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  benzyna: "Benzyna",
  diesel: "Diesel",
  hybryda: "Hybryda",
  elektryczny: "Elektryczny",
  lpg: "LPG",
};

export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  manualna: "Manualna",
  automatyczna: "Automatyczna",
};

export const CANCELLATION_POLICY_LABELS: Record<CancellationPolicy, string> = {
  flexible: "Elastyczna",
  moderate: "Umiarkowana",
  strict: "Surowa",
};

export const CANCELLATION_POLICY_DESCRIPTIONS: Record<CancellationPolicy, string> = {
  flexible: "Darmowe anulowanie do 24 godzin przed odbiorem auta.",
  moderate: "Darmowe anulowanie do 3 dni przed odbiorem auta.",
  strict: "Darmowe anulowanie do 7 dni przed odbiorem auta.",
};

export const CANCELLATION_POLICY_FREE_HOURS: Record<CancellationPolicy, number> = {
  flexible: 24,
  moderate: 72,
  strict: 168,
};
