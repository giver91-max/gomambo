import type {
  CancellationPolicy,
  FuelLevel,
  FuelPolicy,
  FuelType,
  Transmission,
  VehicleType,
} from "@/types/database";

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

export const FUEL_POLICY_LABELS: Record<FuelPolicy, string> = {
  full_to_full: "Pełny do pełnego",
  same_level: "Zwrot z takim poziomem jak przy odbiorze",
  included: "Paliwo wliczone w cenę",
};

export const FUEL_POLICY_DESCRIPTIONS: Record<FuelPolicy, string> = {
  full_to_full: "Odbierz auto z pełnym bakiem i zwróć je z pełnym bakiem.",
  same_level: "Zwróć auto z takim samym poziomem paliwa, jaki był przy odbiorze.",
  included: "Koszt paliwa jest wliczony w cenę wynajmu.",
};

export const FUEL_LEVEL_LABELS: Record<FuelLevel, string> = {
  empty: "Pusty",
  quarter: "1/4",
  half: "1/2",
  three_quarters: "3/4",
  full: "Pełny",
};
