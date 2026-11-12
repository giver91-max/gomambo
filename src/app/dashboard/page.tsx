import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPartnerContext, partnerCanList } from "@/lib/partner";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { FleetCarList } from "./fleet-car-list";
import { eachDateInRange, toISODate, addDays } from "@/lib/calendar";
import { getVerificationStatus } from "@/lib/verification-gate";
import { isMaintenanceMode } from "@/lib/maintenance";
import { stripeMode } from "@/lib/stripe";
import { OnboardingSteps, type OnboardingStep } from "./onboarding-steps";

const AVAILABILITY_WINDOW_DAYS = 60;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: cars }, { data: bookings }, { data: reviews }] = await Promise.all([
    supabase.from("cars").select("*").eq("owner_id", user!.id).order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("status, start_date, end_date, total_price, platform_fee_amount, cars(price_per_day)")
      .eq("owner_id", user!.id),
    supabase.from("reviews").select("rating").eq("reviewee_id", user!.id).is("deleted_at", null),
  ]);

  const [partner, verification, maintenance, { data: payoutProfile }] = await Promise.all([
    getPartnerContext(supabase, user!.id),
    getVerificationStatus(supabase, user!.id),
    isMaintenanceMode(),
    supabase.from("profiles").select("stripe_connect_onboarded").eq("id", user!.id).single(),
  ]);
  // A company is created as 'pending' straight from the form, before any
  // document exists — GoMambo cannot start checking until one is uploaded.
  const { count: partnerDocumentCount } = partner
    ? await supabase
        .from("partner_documents")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", partner.partnerId)
    : { count: 0 };
  const canAddCar = partner ? partnerCanList(partner.status) : verification.status === "approved";

  const activeListings = (cars ?? []).filter(
    (c) => c.status === "approved" || c.status === "paused"
  ).length;
  const pendingRequests = (bookings ?? []).filter((b) => b.status === "requested").length;
  const completedBookings = (bookings ?? []).filter((b) => b.status === "completed");
  // What actually landed on the owner's account: the amount charged minus
  // the platform fee. Multiplying nights by today's daily rate ignores the
  // monthly rate, ignores paid extensions and follows later price edits —
  // for a monthly rental it can read double the real payout.
  const estimatedRevenue = completedBookings.reduce((sum, b) => {
    if (b.total_price !== null) {
      return sum + (Number(b.total_price) - Number(b.platform_fee_amount ?? 0));
    }
    const nights = eachDateInRange(b.start_date, b.end_date).length;
    const pricePerDay = Number((b.cars as { price_per_day: number } | null)?.price_per_day ?? 0);
    return sum + nights * pricePerDay;
  }, 0);
  const avgRating =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  // Only bookable statuses need an at-a-glance availability summary — a
  // pending/rejected car can't take reservations yet regardless of dates set.
  const bookableCarIds = (cars ?? [])
    .filter((c) => c.status === "approved" || c.status === "paused")
    .map((c) => c.id);

  const todayIso = toISODate(new Date());
  const windowEndIso = toISODate(addDays(new Date(), AVAILABILITY_WINDOW_DAYS));

  const availabilityByCarId = new Map<string, string[]>();
  if (bookableCarIds.length > 0) {
    const { data: availabilityRows } = await supabase
      .from("car_availability")
      .select("car_id, date")
      .in("car_id", bookableCarIds)
      .gte("date", todayIso)
      .lte("date", windowEndIso)
      .order("date", { ascending: true });

    for (const row of availabilityRows ?? []) {
      const dates = availabilityByCarId.get(row.car_id) ?? [];
      dates.push(row.date);
      availabilityByCarId.set(row.car_id, dates);
    }
  }

  const carList = cars ?? [];
  const liveCars = carList.filter((c) => c.status === "approved" || c.status === "paused");
  const carWithoutDates = liveCars.find((c) => (availabilityByCarId.get(c.id) ?? []).length === 0);
  const paymentsLive = stripeMode() === "live";

  const steps: OnboardingStep[] = [
    partner
      ? {
          title: "Weryfikacja firmy",
          state:
            partner.status === "active"
              ? "done"
              : partner.status === "pending" && (partnerDocumentCount ?? 0) > 0
                ? "waiting"
                : partner.status === "suspended" || partner.status === "terminated"
                  ? "waiting"
                  : "todo",
          note:
            partner.status === "active"
              ? `Wypożyczalnia „${partner.tradeName}” jest zweryfikowana.`
              : partner.status === "suspended" || partner.status === "terminated"
                ? "Współpraca jest wstrzymana — napisz do nas na kontakt@gomambo.pl."
                : (partnerDocumentCount ?? 0) > 0
                  ? "Sprawdzamy dane firmy i dokumenty — damy znać mailem."
                  : "Dodaj odpis z CEIDG lub KRS — bez niego nie zaczniemy weryfikacji.",
          href: "/dashboard/firma",
          cta: "Panel firmy",
        }
      : {
          title: "Weryfikacja tożsamości",
          state:
            verification.status === "approved"
              ? "done"
              : verification.status === "pending"
                ? "waiting"
                : "todo",
          note:
            verification.status === "approved"
              ? "Prawo jazdy i selfie zweryfikowane."
              : verification.status === "pending"
                ? "Sprawdzamy zdjęcia — damy znać mailem."
                : verification.status === "rejected"
                  ? "Weryfikacja wymaga poprawek — wyślij zdjęcia jeszcze raz."
                  : "Prawo jazdy (obie strony) i selfie — kilka minut. Prowadzisz wypożyczalnię? Zamiast tego załóż konto firmy — link „Prowadzisz wypożyczalnię?” powyżej.",
          href: "/dashboard/profile#weryfikacja",
          cta: "Zweryfikuj się",
        },
    {
      title: "Dodaj auto",
      state: carList.length > 0 ? "done" : canAddCar ? "todo" : "later",
      note:
        carList.length > 0
          ? `Dodane auta: ${carList.length}.`
          : canAddCar
            ? "Zdjęcia, numer rejestracyjny i polisa OC."
            : "Po weryfikacji.",
      href: "/dashboard/cars/new",
      cta: "Dodaj auto",
    },
    {
      title: "Zatwierdzenie przez GoMambo",
      state:
        liveCars.length > 0
          ? "done"
          : carList.some((c) => c.status === "pending")
            ? "waiting"
            : carList.some((c) => c.status === "rejected")
              ? "todo"
              : "later",
      note:
        liveCars.length > 0
          ? "Masz zatwierdzone auto."
          : carList.some((c) => c.status === "pending")
            ? "Sprawdzamy ogłoszenie — damy znać mailem."
            : carList.some((c) => c.status === "rejected")
              ? "Ogłoszenie wymaga poprawek — popraw je i wyślij ponownie."
              : "Po dodaniu auta.",
      href: carList.find((c) => c.status === "rejected")
        ? `/dashboard/cars/${carList.find((c) => c.status === "rejected")!.id}/edit`
        : undefined,
      cta: "Popraw auto",
    },
    {
      title: "Ustaw dostępność",
      state: liveCars.length === 0 ? "later" : carWithoutDates ? "todo" : "done",
      note:
        liveCars.length === 0
          ? "Po zatwierdzeniu auta."
          : carWithoutDates
            ? `${carWithoutDates.brand} ${carWithoutDates.model} nie ma wolnych dni w najbliższych ${AVAILABILITY_WINDOW_DAYS} dniach.`
            : "Zatwierdzone auta mają ustawione wolne dni.",
      href: carWithoutDates ? `/dashboard/cars/${carWithoutDates.id}/availability` : undefined,
      cta: "Ustaw dni",
    },
    {
      title: "Konto do wypłat",
      state: !paymentsLive ? "later" : payoutProfile?.stripe_connect_onboarded ? "done" : "todo",
      note: !paymentsLive
        ? "Uruchomimy je razem z wynajmem — teraz nic nie musisz robić."
        : payoutProfile?.stripe_connect_onboarded
          ? "Wypłaty skonfigurowane."
          : "Bez niego najemca nie zapłaci kartą ani BLIK-iem.",
      href: "/dashboard/profile#wyplaty",
      cta: "Skonfiguruj wypłaty",
    },
  ];
  const showSteps = steps.some((s) => s.state === "todo" || s.state === "waiting");

  const stats: { label: string; value: string }[] = [
    { label: "Aktywne ogłoszenia", value: String(activeListings) },
    { label: "Zapytania oczekujące", value: String(pendingRequests) },
    { label: "Zakończone wynajmy", value: String(completedBookings.length) },
    { label: "Szacowany przychód", value: `${estimatedRevenue.toFixed(0)} zł` },
    { label: "Średnia ocena", value: avgRating !== null ? `★ ${avgRating.toFixed(1)}` : "brak ocen" },
  ];

  return (
    <div className="space-y-6">
      <BackButton />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Moje auta</h1>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/firma" className="text-sm text-primary hover:underline">
            {partner ? "Moja wypożyczalnia" : "Prowadzisz wypożyczalnię?"} →
          </Link>
          <Link href="/dashboard/kalendarz" className="text-sm text-primary hover:underline">
            Kalendarz floty →
          </Link>
          <Link href="/dashboard/cars/new" className={buttonVariants()}>
            + Dodaj auto
          </Link>
        </div>
      </div>

      {maintenance && (
        <p className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <strong>Katalog dla najemców jest jeszcze zamknięty</strong> — zbieramy auta przed
          startem. Zatwierdzone auta pojawią się w nim automatycznie w dniu startu, a my damy Ci
          znać mailem. Swoje ogłoszenie możesz już obejrzeć tak, jak zobaczą je najemcy.
        </p>
      )}

      {showSteps && <OnboardingSteps steps={steps} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {completedBookings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Szacowany przychód liczony jest z aktualnej ceny za dzień auta, nie z ceny
          obowiązującej w momencie rezerwacji.
        </p>
      )}

      {!cars || cars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie dodałeś jeszcze żadnego auta.
          </CardContent>
        </Card>
      ) : (
        <FleetCarList cars={cars} availabilityByCarId={Object.fromEntries(availabilityByCarId)} />
      )}
    </div>
  );
}
