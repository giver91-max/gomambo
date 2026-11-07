import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, Database } from "@/types/database";
import type { NewCarInitialValues } from "@/app/dashboard/cars/new/new-car-form";

/**
 * The listing fields of the "add a car" form, read and validated in one
 * place. Two actions take this form — an owner adding their own car and an
 * admin adding one for an owner or a rental company — and a rule tightened
 * in one and forgotten in the other would be a listing that slips past it.
 */
export type CarListingFields = {
  brand: string;
  model: string;
  year: number;
  price_per_day: number;
  city: string;
  description: string | null;
  vehicle_type: Car["vehicle_type"];
  fuel_type: Car["fuel_type"];
  transmission: Car["transmission"];
  seats: number;
  mileage_limit_km: number | null;
  mileage_overage_fee_per_km: number | null;
  fuel_policy: Car["fuel_policy"];
  security_deposit_amount: number | null;
  price_per_month: number | null;
  delivery_available: boolean;
  delivery_info: string | null;
  cancellation_policy: Car["cancellation_policy"];
};

export function parseCarListingForm(
  formData: FormData
):
  | { ok: true; fields: CarListingFields; registrationNumber: string }
  | { ok: false; error: string } {
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = Number(formData.get("year"));
  const pricePerDay = Number(formData.get("price_per_day"));
  const city = String(formData.get("city") ?? "").trim();
  const registrationNumber = String(formData.get("registration_number") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const vehicleType = String(formData.get("vehicle_type") ?? "").trim();
  const fuelType = String(formData.get("fuel_type") ?? "").trim();
  const transmission = String(formData.get("transmission") ?? "").trim();
  const seats = Number(formData.get("seats"));
  const mileageLimitRaw = String(formData.get("mileage_limit_km") ?? "").trim();
  const mileageLimit = mileageLimitRaw ? Number(mileageLimitRaw) : null;
  const mileageOverageFeeRaw = String(formData.get("mileage_overage_fee_per_km") ?? "").trim();
  const mileageOverageFee = mileageOverageFeeRaw ? Number(mileageOverageFeeRaw) : null;
  const fuelPolicy = String(formData.get("fuel_policy") ?? "full_to_full").trim();
  const securityDepositRaw = String(formData.get("security_deposit_amount") ?? "").trim();
  const securityDeposit = securityDepositRaw ? Number(securityDepositRaw) : null;
  const pricePerMonthRaw = String(formData.get("price_per_month") ?? "").trim();
  const pricePerMonth = pricePerMonthRaw ? Number(pricePerMonthRaw) : null;
  const deliveryAvailable = formData.get("delivery_available") === "true";
  const deliveryInfo = String(formData.get("delivery_info") ?? "").trim();
  const cancellationPolicy = String(formData.get("cancellation_policy") ?? "moderate").trim();

  if (!brand || !model || !city) {
    return { ok: false, error: "Wypełnij markę, model i miasto." };
  }
  if (!registrationNumber) {
    return { ok: false, error: "Podaj numer rejestracyjny." };
  }
  if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
    return { ok: false, error: "Podaj prawidłowy rok produkcji." };
  }
  if (!(pricePerDay > 0)) {
    return { ok: false, error: "Cena za dzień musi być większa od zera." };
  }
  if (!vehicleType || !fuelType || !transmission) {
    return { ok: false, error: "Wybierz typ pojazdu, rodzaj paliwa i skrzynię biegów." };
  }
  if (!Number.isInteger(seats) || seats < 1 || seats > 9) {
    return { ok: false, error: "Podaj prawidłową liczbę miejsc (1–9)." };
  }
  if (mileageLimit !== null && !(mileageLimit > 0)) {
    return { ok: false, error: "Limit kilometrów musi być większy od zera." };
  }
  if (mileageOverageFee !== null && mileageOverageFee < 0) {
    return { ok: false, error: "Opłata za km ponad limit nie może być ujemna." };
  }
  if (securityDeposit !== null && securityDeposit < 0) {
    return { ok: false, error: "Kaucja nie może być ujemna." };
  }
  if (pricePerMonth !== null && !(pricePerMonth > 0)) {
    return { ok: false, error: "Cena za miesiąc musi być większa od zera." };
  }

  return {
    ok: true,
    registrationNumber,
    fields: {
      brand,
      model,
      year,
      price_per_day: pricePerDay,
      city,
      description: description || null,
      vehicle_type: vehicleType as Car["vehicle_type"],
      fuel_type: fuelType as Car["fuel_type"],
      transmission: transmission as Car["transmission"],
      seats,
      mileage_limit_km: mileageLimit,
      mileage_overage_fee_per_km: mileageOverageFee,
      fuel_policy: fuelPolicy as Car["fuel_policy"],
      security_deposit_amount: securityDeposit,
      price_per_month: pricePerMonth,
      delivery_available: deliveryAvailable,
      delivery_info: deliveryAvailable && deliveryInfo ? deliveryInfo : null,
      cancellation_policy: cancellationPolicy as Car["cancellation_policy"],
    },
  };
}

/**
 * An existing listing as the starting values of a new one — "duplicate" for
 * an owner, and "add the next car of this fleet" for an admin. Only cars of
 * `ownerId` qualify, so a crafted ?duplicateFrom= cannot read anyone else's.
 * Never the plate, the policy or the photos: each physical car needs its own.
 */
export async function loadCarAsInitialValues(
  supabase: SupabaseClient<Database>,
  carId: string,
  ownerId: string
): Promise<NewCarInitialValues | undefined> {
  const { data: source } = await supabase
    .from("cars")
    .select(
      `owner_id, brand, model, year, price_per_day, city, vehicle_type, fuel_type,
       transmission, seats, mileage_limit_km, mileage_overage_fee_per_km, price_per_month,
       security_deposit_amount, fuel_policy, delivery_available, delivery_info,
       cancellation_policy, description`
    )
    .eq("id", carId)
    .maybeSingle();
  if (!source || source.owner_id !== ownerId) return undefined;
  return {
    brand: source.brand,
    model: source.model,
    year: source.year,
    price_per_day: source.price_per_day,
    city: source.city,
    vehicle_type: source.vehicle_type,
    fuel_type: source.fuel_type,
    transmission: source.transmission,
    seats: source.seats,
    mileage_limit_km: source.mileage_limit_km,
    mileage_overage_fee_per_km: source.mileage_overage_fee_per_km,
    price_per_month: source.price_per_month,
    security_deposit_amount: source.security_deposit_amount,
    fuel_policy: source.fuel_policy,
    delivery_available: source.delivery_available,
    delivery_info: source.delivery_info,
    cancellation_policy: source.cancellation_policy,
    description: source.description,
  };
}
