import { redirect } from "next/navigation";
import { NewCarForm, type NewCarInitialValues } from "./new-car-form";
import { BackButton } from "@/components/back-button";
import { VerificationRequiredNotice } from "@/components/verification-required-notice";
import { createClient } from "@/lib/supabase/server";
import { getVerificationStatus } from "@/lib/verification-gate";

export default async function NewCarPage({
  searchParams,
}: {
  searchParams: { duplicateFrom?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { status, rejectionReason } = await getVerificationStatus(supabase, user.id);

  let initialValues: NewCarInitialValues | undefined;
  if (searchParams.duplicateFrom) {
    const { data: source } = await supabase
      .from("cars")
      .select(
        `owner_id, brand, model, year, price_per_day, city, vehicle_type, fuel_type,
         transmission, seats, mileage_limit_km, mileage_overage_fee_per_km, price_per_month,
         security_deposit_amount, fuel_policy, delivery_available, delivery_info,
         cancellation_policy, description`
      )
      .eq("id", searchParams.duplicateFrom)
      .single();
    if (source && source.owner_id === user.id) {
      initialValues = {
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
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Dodaj auto</h1>
      {status === "approved" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Po dodaniu auto trafi do weryfikacji przez administratora. Otrzymasz
            informację, gdy zostanie zatwierdzone lub odrzucone.
          </p>
          {initialValues && (
            <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
              Dane wypełnione z istniejącego ogłoszenia — uzupełnij numer rejestracyjny,
              polisę OC i zdjęcia tego konkretnego auta.
            </p>
          )}
          <NewCarForm initialValues={initialValues} />
        </>
      ) : (
        <VerificationRequiredNotice status={status} rejectionReason={rejectionReason} />
      )}
    </div>
  );
}
