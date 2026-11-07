import Link from "next/link";
import { redirect } from "next/navigation";
import { NewCarForm } from "./new-car-form";
import { BackButton } from "@/components/back-button";
import { VerificationRequiredNotice } from "@/components/verification-required-notice";
import { createClient } from "@/lib/supabase/server";
import { getVerificationStatus } from "@/lib/verification-gate";
import { getPartnerContext, partnerCanList } from "@/lib/partner";
import { loadCarAsInitialValues } from "@/lib/car-form";

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

  // The same two gates createCarDraft uses, or the form never renders for a
  // company: a rental firm has no driving licence to verify, which is the
  // whole reason the Partner gate exists. Fixing only the server action left
  // this page refusing everyone it was meant to let in.
  const partner = await getPartnerContext(supabase, user.id);
  const { status, rejectionReason } = await getVerificationStatus(supabase, user.id);
  const canAddCar = partner ? partnerCanList(partner.status) : status === "approved";

  const initialValues = searchParams.duplicateFrom
    ? await loadCarAsInitialValues(supabase, searchParams.duplicateFrom, user.id)
    : undefined;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Dodaj auto</h1>
      {canAddCar ? (
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
      ) : partner ? (
        // A Partner blocked here is waiting on GoMambo, not on their own
        // documents — pointing them at the driving-licence screen would be
        // sending them somewhere that cannot help.
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium text-foreground">
            {partner.status === "pending"
              ? "Weryfikujemy Twoją wypożyczalnię"
              : "Wypożyczalnia nie może w tej chwili dodawać aut"}
          </p>
          <p className="text-muted-foreground">
            {partner.status === "pending"
              ? "Sprawdzamy dane firmy i dokumenty. Damy znać mailem, gdy będziesz mógł dodać pierwsze auto — zwykle tego samego dnia."
              : "Napisz do nas, a wyjaśnimy, co jest potrzebne do wznowienia współpracy."}
          </p>
          <Link href="/dashboard/firma" className="text-primary hover:underline">
            Przejdź do panelu firmy →
          </Link>
        </div>
      ) : (
        <VerificationRequiredNotice
          status={status}
          rejectionReason={rejectionReason}
          purpose="add_car"
        />
      )}
    </div>
  );
}
