import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, Database } from "@/types/database";
import type { NewCarInitialValues } from "@/app/dashboard/cars/new/new-car-form";
import { getVerificationStatus } from "@/lib/verification-gate";
import { getPartnerContext, partnerCanList, type PartnerContext } from "@/lib/partner";
import { toISODate } from "@/lib/calendar";
import {
  CANCELLATION_POLICY_LABELS,
  FUEL_POLICY_LABELS,
  FUEL_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_TYPE_LABELS,
} from "@/lib/car-options";

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
  // Checked here rather than left to the CHECK constraints: an edit writes
  // car_private before cars, and a crafted value that only the database
  // refused would have left half a save behind.
  if (
    !(vehicleType in VEHICLE_TYPE_LABELS) ||
    !(fuelType in FUEL_TYPE_LABELS) ||
    !(transmission in TRANSMISSION_LABELS) ||
    !(fuelPolicy in FUEL_POLICY_LABELS) ||
    !(cancellationPolicy in CANCELLATION_POLICY_LABELS)
  ) {
    return { ok: false, error: "Nieprawidłowa wartość w formularzu. Odśwież stronę i spróbuj ponownie." };
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

/**
 * May this account put a car in front of GoMambo for review? Two different
 * gates, because two different things are being checked. An individual
 * listing their own car is vouched for by their identity and driving
 * licence. A rental company has no driving licence — what matters is that
 * the COMPANY is real and verified (see 0042). Messages are worded for the
 * account holder; the admin's "add for an owner" path words its own.
 */
export async function ownerListingGate(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{ partner: PartnerContext | null; error: string | null }> {
  const partner = await getPartnerContext(supabase, userId);
  if (partner) {
    if (!partnerCanList(partner.status)) {
      return {
        partner,
        error:
          partner.status === "pending"
            ? "Weryfikujemy jeszcze Twoją wypożyczalnię — damy znać, gdy będziesz mógł dodawać auta."
            : "Twoja wypożyczalnia nie może w tej chwili dodawać aut. Napisz do nas.",
      };
    }
    return { partner, error: null };
  }
  const { status } = await getVerificationStatus(supabase, userId);
  if (status !== "approved") {
    return {
      partner: null,
      error: "Musisz najpierw zweryfikować tożsamość i prawo jazdy, zanim dodasz auto.",
    };
  }
  return { partner: null, error: null };
}

export type CarDocumentFields = {
  insurance_valid_until: string;
  inspection_valid_until: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFutureDate(raw: FormDataEntryValue | null): string | null | "past" {
  const value = String(raw ?? "").trim();
  if (!ISO_DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  // "2026-02-31" parses to March; a real calendar date round-trips.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value < toISODate(new Date()) ? "past" : value;
}

/**
 * The OC policy's and the inspection's end dates, and the owner's statement
 * that they may rent the car out — what lets the daily job warn the owner
 * and pause a listing that is no longer legal to drive (0051). Required for
 * every new car and on every edit, so the cars listed before this existed
 * get their dates the first time their owner touches them.
 */
export function parseCarDocumentsForm(
  formData: FormData,
  { rentalRightAlreadyConfirmed }: { rentalRightAlreadyConfirmed: boolean }
): { ok: true; documents: CarDocumentFields; rentalRightConfirmedNow: boolean } | { ok: false; error: string } {
  const insurance = parseFutureDate(formData.get("insurance_valid_until"));
  if (insurance === null) return { ok: false, error: "Podaj, do kiedy jest ważna polisa OC." };
  if (insurance === "past") {
    return { ok: false, error: "Polisa OC już wygasła — dodaj aktualną polisę i jej datę ważności." };
  }
  const inspection = parseFutureDate(formData.get("inspection_valid_until"));
  if (inspection === null) {
    return { ok: false, error: "Podaj termin następnego badania technicznego (z dowodu rejestracyjnego)." };
  }
  if (inspection === "past") {
    return { ok: false, error: "Badanie techniczne już wygasło — auto bez ważnego przeglądu nie może być wynajmowane." };
  }
  const rentalRight = formData.get("rental_right") === "on";
  if (!rentalRight && !rentalRightAlreadyConfirmed) {
    return {
      ok: false,
      error: "Potwierdź, że możesz wynajmować to auto (jesteś właścicielem albo masz zgodę właściciela lub leasingodawcy).",
    };
  }
  return {
    ok: true,
    documents: { insurance_valid_until: insurance, inspection_valid_until: inspection },
    rentalRightConfirmedNow: rentalRight && !rentalRightAlreadyConfirmed,
  };
}

/** Must match the marker enforce_car_update_rules writes (0051). */
export const DOCUMENTS_EXPIRED_REASON =
  "Wstrzymane: wygasła polisa OC lub badanie techniczne — dodaj aktualny dokument w edycji auta.";

/**
 * Whether a car's known OC or inspection date has passed. A missing date is
 * not "expired" (cars listed before 0051) — the same rule as the trigger.
 */
export async function carDocumentsExpired(
  supabase: SupabaseClient<Database>,
  carId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("car_private")
    .select("insurance_valid_until, inspection_valid_until")
    .eq("car_id", carId)
    .maybeSingle();
  const today = toISODate(new Date());
  return (
    (!!data?.insurance_valid_until && data.insurance_valid_until < today) ||
    (!!data?.inspection_valid_until && data.inspection_valid_until < today)
  );
}
