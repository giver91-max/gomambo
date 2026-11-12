import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { NewCarForm } from "@/app/dashboard/cars/new/new-car-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVerificationStatus } from "@/lib/verification-gate";
import { getPartnerContext, partnerCanList } from "@/lib/partner";
import { loadCarAsInitialValues } from "@/lib/car-form";
import { getOwnerCommissionRate } from "@/lib/commission";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Add a car on someone else's account — see the actions next to this file.
 * Reached from a user's admin page or from a company on /admin/partnerzy.
 * After each car the page comes back pre-filled from the one just added, so
 * a fleet of similar cars is a plate, a policy and photos per car.
 */
export default async function AdminNewCarPage({
  searchParams,
}: {
  searchParams: { owner?: string; added?: string };
}) {
  // /admin is gated in middleware too, but this page reads with the service
  // role — it must not depend on a single gate.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  if (me?.role !== "admin") notFound();

  const ownerId = searchParams.owner && UUID_RE.test(searchParams.owner) ? searchParams.owner : null;

  if (!ownerId) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <BackButton />
        <h1 className="text-2xl font-bold">Dodaj auto za właściciela</h1>
        <p className="text-sm text-muted-foreground">
          Wybierz, na czyje konto dodajesz auto: wejdź w{" "}
          <Link href="/admin/users" className="text-primary hover:underline">
            Użytkownicy
          </Link>{" "}
          albo{" "}
          <Link href="/admin/partnerzy?status=active" className="text-primary hover:underline">
            Wypożyczalnie
          </Link>{" "}
          i kliknij „Dodaj auto”.
        </p>
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ data: owner }, { data: authUser }, partner, verification] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", ownerId).maybeSingle(),
    admin.auth.admin.getUserById(ownerId),
    getPartnerContext(admin, ownerId),
    getVerificationStatus(admin, ownerId),
  ]);

  const added =
    searchParams.added && UUID_RE.test(searchParams.added)
      ? await admin
          .from("cars")
          .select("brand, model, year")
          .eq("id", searchParams.added)
          .eq("owner_id", ownerId)
          .maybeSingle()
          .then(({ data }) => data)
      : null;
  const initialValues = added
    ? await loadCarAsInitialValues(admin, searchParams.added!, ownerId)
    : undefined;

  const ownerLabel = owner?.full_name || authUser?.user?.email || "ten użytkownik";
  const canList = partner ? partnerCanList(partner.status) : verification.status === "approved";

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <BackButton />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Dodaj auto za właściciela</h1>
        <p className="text-sm text-muted-foreground">
          Konto:{" "}
          <Link href={`/admin/users/${ownerId}`} className="text-primary hover:underline">
            {ownerLabel}
          </Link>
          {partner ? ` · wypożyczalnia „${partner.tradeName}” (rezerwacje potwierdza firma)` : " · osoba prywatna"}
        </p>
      </div>

      {!owner ? (
        <p className="text-sm text-destructive">Nie ma takiego użytkownika.</p>
      ) : !canList ? (
        <p className="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm">
          {partner
            ? `Wypożyczalnia „${partner.tradeName}” nie jest jeszcze aktywna. Zweryfikuj ją w zakładce Wypożyczalnie — potem dodasz jej auta.`
            : "Ten użytkownik nie ma zatwierdzonej weryfikacji tożsamości. Jeśli to firma, niech najpierw założy wypożyczalnię w panelu „Firma” — wtedy weryfikujesz firmę, nie prawo jazdy."}
        </p>
      ) : (
        <>
          {added && (
            <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="font-medium">
                ✓ Dodano i zatwierdzono: {added.brand} {added.model} ({added.year})
              </p>
              <p className="text-muted-foreground">
                Właściciel nie dostaje maila o każdym aucie — daj mu znać sam, gdy skończysz.
                Formularz poniżej ma dane tego auta: zmień numer rejestracyjny, polisę i zdjęcia,
                żeby dodać kolejne.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Auto trafi na konto właściciela i od razu będzie zatwierdzone — sprawdzasz je teraz,
            więc nie czeka w kolejce. Właściciel może je potem edytować jak swoje.
          </p>
          <NewCarForm
            key={searchParams.added ?? "new"}
            initialValues={initialValues}
            forOwnerId={ownerId}
            commissionRate={await getOwnerCommissionRate(ownerId)}
          />
        </>
      )}
    </div>
  );
}
