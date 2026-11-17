import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { countPartnerDocuments, getPartnerContext, partnerCanList } from "@/lib/partner";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { FleetCarList } from "./fleet-car-list";
import { eachDateInRange, toISODate, addDays } from "@/lib/calendar";
import { getVerificationStatus } from "@/lib/verification-gate";
import { isMaintenanceMode } from "@/lib/maintenance";
import { stripeMode } from "@/lib/stripe";
import { OnboardingSteps, type OnboardingStep } from "./onboarding-steps";
import { VERIFICATION_PATH } from "@/lib/links";
import { formatPriceZl } from "@/lib/money-format";
import { joinPolishList, missingCarDocuments, type CarDocumentsRecord } from "@/lib/car-form";
import { ownerSideReadyForReview } from "@/app/admin/cars/approval-gate";

const AVAILABILITY_WINDOW_DAYS = 60;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: cars }, { data: bookings }, { data: reviews }] = await Promise.all([
    supabase
      .from("cars")
      .select(
        "*, car_private(registration_number, insurance_document_path, insurance_valid_until, inspection_valid_until, rental_right_confirmed_at)"
      )
      .eq("owner_id", user!.id)
      .order("created_at", { ascending: false }),
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
  const partnerDocumentCount = partner ? await countPartnerDocuments(supabase, partner.partnerId) : 0;
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

  // The documents stay on the server: the list below only gets, per car,
  // the words for what is missing.
  const carList = (cars ?? []).map((car) => ({ ...car, car_private: undefined }));
  const missingDocumentsByCarId = new Map<string, string>();
  for (const car of cars ?? []) {
    // One-to-one (car_id is the primary key), but be tolerant of either shape.
    const record = (Array.isArray(car.car_private) ? car.car_private[0] : car.car_private) as
      | CarDocumentsRecord
      | null
      | undefined;
    const missing = missingCarDocuments(record);
    if (missing.length > 0) missingDocumentsByCarId.set(car.id, joinPolishList(missing));
  }
  const firstIncompleteCar = carList.find((c) => missingDocumentsByCarId.has(c.id));
  const liveCars = carList.filter((c) => c.status === "approved" || c.status === "paused");
  // For the steps (not the stats): a car approved before 0051 without its
  // documents is not done — the "Dodaj auto" step above asks for them, and
  // saving them sends it back for review. Counting it here crossed out
  // "Zatwierdzenie" and asked for dates, then both stepped back.
  const stepLiveCars = liveCars.filter((c) => !missingDocumentsByCarId.has(c.id));
  const liveCarsMissingDocuments = liveCars.length > stepLiveCars.length;
  // "Sprawdzamy ogłoszenie" only for a car GoMambo can actually review: one
  // still missing its documents is waiting for its owner, and so is one whose
  // owner (or company) is not verified — approval-gate.ts refuses those.
  const pendingCars = carList.filter((c) => c.status === "pending");
  const ownerReady = (car: (typeof carList)[number]) =>
    ownerSideReadyForReview({
      carPartnerId: car.partner_id,
      partner,
      partnerDocumentCount,
      ownerVerification: verification.status,
    });
  const completePendingCars = pendingCars.filter((c) => !missingDocumentsByCarId.has(c.id));
  const pendingReadyForReview = completePendingCars.some(ownerReady);
  const carBlockedByOwner = completePendingCars.find((c) => !ownerReady(c));
  const rejectedCar = carList.find((c) => c.status === "rejected");
  const carWithoutDates = stepLiveCars.find((c) => (availabilityByCarId.get(c.id) ?? []).length === 0);
  const paymentsLive = stripeMode() === "live";

  const steps: OnboardingStep[] = [
    partner
      ? {
          title: "Weryfikacja firmy",
          state:
            partner.status === "active"
              ? "done"
              : partner.status === "pending" && partnerDocumentCount > 0
                ? "waiting"
                : partner.status === "suspended" || partner.status === "terminated"
                  ? "waiting"
                  : "todo",
          note:
            partner.status === "active"
              ? `Wypożyczalnia „${partner.tradeName}” jest zweryfikowana.`
              : partner.status === "suspended" || partner.status === "terminated"
                ? "Współpraca jest wstrzymana — napisz do nas na kontakt@gomambo.pl."
                : // 'draft' = "Poproś o poprawki" (admin/partnerzy): GoMambo is
                  // waiting on the company, so "Sprawdzamy…" would be wrong.
                  partner.status === "draft"
                  ? "GoMambo prosi o poprawki — szczegóły w panelu firmy."
                  : partnerDocumentCount > 0
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
          href: VERIFICATION_PATH,
          cta: "Zweryfikuj się",
        },
    firstIncompleteCar
      ? {
          // An added car is not finished until it has its plate, policy,
          // dates and statement — whatever its status.
          title: "Dodaj auto",
          state: "todo",
          note:
            `${firstIncompleteCar.brand} ${firstIncompleteCar.model}: uzupełnij ${missingDocumentsByCarId.get(firstIncompleteCar.id)}.` +
            (missingDocumentsByCarId.size > 1 ? " Braki w pozostałych autach widać na liście poniżej." : ""),
          href: `/dashboard/cars/${firstIncompleteCar.id}/edit`,
          cta: "Uzupełnij dane auta",
        }
      : {
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
        stepLiveCars.length > 0
          ? "done"
          : pendingReadyForReview
            ? "waiting"
            : rejectedCar
              ? "todo"
              : "later",
      note:
        stepLiveCars.length > 0
          ? "Masz zatwierdzone auto."
          : pendingReadyForReview
            ? "Sprawdzamy ogłoszenie — damy znać mailem."
            : rejectedCar
              ? "Ogłoszenie wymaga poprawek — popraw je i wyślij ponownie."
              : carBlockedByOwner
                ? carBlockedByOwner.partner_id
                  ? "Sprawdzimy ogłoszenie po weryfikacji firmy (pierwszy krok)."
                  : partner
                    ? // The first step is the company's here, not the identity's.
                      "Sprawdzimy ogłoszenie po weryfikacji Twojej tożsamości w profilu."
                    : "Sprawdzimy ogłoszenie po weryfikacji tożsamości (pierwszy krok)."
                : liveCarsMissingDocuments
                  ? "Po uzupełnieniu danych auta (krok wyżej) sprawdzimy je jeszcze raz."
                  : pendingCars.length > 0
                    ? "Sprawdzimy ogłoszenie, gdy uzupełnisz dane auta (krok wyżej)."
                    : "Po dodaniu auta.",
      href: rejectedCar ? `/dashboard/cars/${rejectedCar.id}/edit` : undefined,
      cta: "Popraw auto",
    },
    {
      title: "Ustaw dostępność",
      state: stepLiveCars.length === 0 ? "later" : carWithoutDates ? "todo" : "done",
      note:
        stepLiveCars.length === 0
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
    { label: "Szacowany przychód", value: formatPriceZl(estimatedRevenue) },
    { label: "Średnia ocena", value: avgRating !== null ? `★ ${avgRating.toFixed(1)}` : "brak ocen" },
  ];

  return (
    <div className="space-y-6">
      <BackButton />
      {/* Wraps on a phone: in one row the three links and the button ran
          ~20 px past a 360 px screen and the page scrolled sideways. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold">Moje auta</h1>
        <div className="flex flex-wrap items-center gap-3">
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
          startem. Zatwierdzone auta z ważnym OC i przeglądem pojawią się w nim automatycznie w dniu
          startu, a my damy Ci znać mailem. Swoje ogłoszenie możesz już obejrzeć tak, jak zobaczą je
          najemcy.
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

      {carList.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nie masz jeszcze żadnego auta.
          </CardContent>
        </Card>
      ) : (
        <FleetCarList
          cars={carList}
          availabilityByCarId={Object.fromEntries(availabilityByCarId)}
          missingDocumentsByCarId={Object.fromEntries(missingDocumentsByCarId)}
        />
      )}
    </div>
  );
}
