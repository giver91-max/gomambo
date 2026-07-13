import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteFooter } from "@/components/site-footer";
import { BackButton } from "@/components/back-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CANCELLATION_POLICY_DESCRIPTIONS,
  CANCELLATION_POLICY_LABELS,
  FUEL_TYPE_LABELS,
  VEHICLE_TYPE_LABELS,
} from "@/lib/car-options";
import type { CancellationPolicy } from "@/types/database";

export const metadata: Metadata = {
  title: "Wynajmij auto — jak to działa na GoMambo",
  description:
    "Zasady wynajmu auta od prywatnego właściciela na GoMambo: wymagania, odpowiedzialność najemcy, ubezpieczenie i polityka anulowania.",
  alternates: { canonical: "/wynajmij-auto" },
};

const STEPS = [
  {
    icon: "🔍",
    title: "Znajdź auto",
    body: "Przeglądaj ogłoszenia w swojej okolicy, filtruj po typie pojazdu, paliwie, cenie i terminie.",
  },
  {
    icon: "💬",
    title: "Wyślij zapytanie",
    body: "Zaznacz termin i napisz do właściciela. Odpowiada bezpośrednio w wiadomościach na GoMambo.",
  },
  {
    icon: "🔑",
    title: "Odbierz auto i jedź",
    body: "Ustal z właścicielem miejsce i godzinę odbioru. Zróbcie razem zdjęcia auta na start i na koniec wynajmu.",
  },
];

const REQUIREMENTS = [
  "Masz ukończone 21 lat.",
  "Posiadasz ważne prawo jazdy kat. B od co najmniej roku.",
  "Twoje konto ma potwierdzoną tożsamość i prawo jazdy (dokument + selfie na żywo).",
  "Akceptujesz Regulamin serwisu przy rejestracji.",
];

const RESPONSIBILITIES = [
  "Auto prowadzi wyłącznie osoba, która dokonała rezerwacji, chyba że właściciel wyraźnie zgodzi się na kierowcę dodatkowego.",
  "Zwracasz auto z takim samym poziomem paliwa, jak przy odbiorze, chyba że ustalicie inaczej.",
  "Jeśli właściciel określił limit kilometrów dla wynajmu, mieścisz się w nim — rozliczenie nadwyżki ustalacie bezpośrednio.",
  "Mandaty, opłaty za parkowanie i inne kary drogowe z okresu wynajmu obciążają najemcę.",
  "Odbiór i zwrot dokumentujecie zdjęciami w panelu rezerwacji — to podstawa do wyjaśnienia ewentualnego sporu o stan auta.",
  "Zasady dotyczące palenia, zwierząt czy dodatkowego sprzątania właściciel opisuje w ogłoszeniu — warto sprawdzić przed rezerwacją.",
];

const FAQS = [
  {
    q: "Czy muszę mieć własne ubezpieczenie?",
    a: "Każde auto na GoMambo ma obowiązkową polisę OC właściciela — w Polsce ubezpieczenie OC jest przypisane do pojazdu, więc obejmuje szkody wobec osób trzecich niezależnie od tego, kto prowadzi, o ile ma ważne prawo jazdy. GoMambo nie oferuje obecnie własnego ubezpieczenia AC ani pakietu ochrony od szkód własnych pojazdu — to warto mieć na uwadze i ewentualnie ustalić z właścicielem przed rezerwacją.",
  },
  {
    q: "Kto odpowiada za uszkodzenia auta w trakcie wynajmu?",
    a: "Umowę najmu zawierają bezpośrednio właściciel i najemca — GoMambo jest platformą ogłoszeniową i nie jest stroną tej umowy (szczegóły w Regulaminie). Zdjęcia z odbioru i zwrotu, które robicie w panelu rezerwacji, są głównym dowodem w razie sporu o stan auta.",
  },
  {
    q: "Czy ktoś inny może prowadzić wynajęte auto?",
    a: "Co do zasady auto prowadzi tylko osoba, która dokonała rezerwacji. Jeśli potrzebujesz dodatkowego kierowcy, ustal to z właścicielem przed odbiorem auta.",
  },
  {
    q: "Jaka jest polityka anulowania?",
    a: "Każdy właściciel ustawia jedną z trzech polityk anulowania dla swojego auta — zawsze widzisz ją na stronie ogłoszenia, zanim wyślesz zapytanie.",
  },
  {
    q: "Co jeśli mam problem z autem w trakcie wynajmu?",
    a: "Najpierw skontaktuj się bezpośrednio z właścicielem przez wiadomości w serwisie. W sprawach związanych z samym kontem lub weryfikacją napisz do nas przez czat w panelu.",
  },
  {
    q: "Czy mogę zamówić dowóz auta?",
    a: "Część właścicieli oferuje dowóz — informację o tym i orientacyjny koszt znajdziesz na stronie konkretnego ogłoszenia.",
  },
];

const CANCELLATION_ORDER: CancellationPolicy[] = ["flexible", "moderate", "strict"];

export default async function RentACarInfoPage() {
  const supabase = await createClient();

  const { data: rawCars } = await supabase
    .from("cars")
    .select(
      "id, brand, model, year, city, price_per_day, vehicle_type, fuel_type, seats, car_images(storage_path, position)"
    )
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .order("position", { referencedTable: "car_images", ascending: true })
    .limit(6);

  const cars = (rawCars ?? []).map((car) => {
    const images = (car.car_images ?? []) as { storage_path: string; position: number }[];
    const imageUrl = images[0]
      ? supabase.storage.from("car-images").getPublicUrl(images[0].storage_path).data.publicUrl
      : null;
    return { ...car, imageUrl };
  });

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-tight">
          Go<span className="text-primary">Mambo</span>
        </Link>
        <Link href="/auta" className={buttonVariants()}>
          Przeglądaj auta
        </Link>
      </header>

      <main className="mx-auto max-w-4xl space-y-16 px-6 py-10">
        <BackButton />

        <section className="space-y-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Dla najemców
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">
            Wynajmij auto
            <br className="hidden sm:block" /> od sąsiada, bez wypożyczalni
          </h1>
          <p className="max-w-xl text-muted-foreground sm:text-lg">
            Sprawdzone auta od prywatnych właścicieli w Twojej okolicy. Zanim
            zarezerwujesz, zobacz poniżej jak to działa, czego potrzebujesz i za co
            odpowiadasz w trakcie wynajmu.
          </p>
          <Link href="/auta" className={buttonVariants({ size: "lg" })}>
            Przeglądaj dostępne auta →
          </Link>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Jak to działa</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <Card key={step.title}>
                <CardContent className="space-y-1 py-5">
                  <p className="text-2xl">{step.icon}</p>
                  <p className="font-semibold">
                    {i + 1}. {step.title}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Co jest potrzebne, żeby wynająć auto</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            {REQUIREMENTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Twoja odpowiedzialność podczas wynajmu</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            {RESPONSIBILITIES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Ubezpieczenie i szkody</h2>
          <p className="text-muted-foreground">
            Każde auto na GoMambo musi mieć aktualną polisę OC właściciela — sprawdzamy to
            ręcznie przy zatwierdzaniu ogłoszenia. OC jest przypisane do pojazdu, więc
            obejmuje szkody wobec osób trzecich niezależnie od tego, kto prowadzi, o ile ma
            ważne prawo jazdy.
          </p>
          <p className="text-muted-foreground">
            GoMambo nie oferuje obecnie własnego ubezpieczenia od szkód własnych pojazdu
            (AC) ani pakietu ochrony na wzór dużych wypożyczalni. Umowę najmu zawieracie
            bezpośrednio Ty i właściciel — dlatego przy odbiorze i zwrocie warto
            udokumentować stan auta zdjęciami w panelu rezerwacji.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Polityka anulowania</h2>
          <p className="text-muted-foreground">
            Każdy właściciel wybiera jedną z trzech polityk dla swojego auta — widzisz ją
            zawsze na stronie ogłoszenia, zanim wyślesz zapytanie.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {CANCELLATION_ORDER.map((policy) => (
              <Card key={policy}>
                <CardContent className="space-y-1 py-5">
                  <p className="font-semibold">{CANCELLATION_POLICY_LABELS[policy]}</p>
                  <p className="text-sm text-muted-foreground">
                    {CANCELLATION_POLICY_DESCRIPTIONS[policy]}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Najczęstsze pytania</h2>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <div key={faq.q} className="space-y-1">
                <p className="font-semibold">{faq.q}</p>
                <p className="text-sm text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-xl bg-muted p-8 text-center">
          <h2 className="text-2xl font-bold">Gotowy, żeby ruszyć w trasę?</h2>
          <p className="text-muted-foreground">
            Przejrzyj dostępne auta i wyślij pierwsze zapytanie — to zajmuje dosłownie chwilę.
          </p>
          <Link href="/auta" className={buttonVariants({ size: "lg" })}>
            Przeglądaj dostępne auta →
          </Link>
        </section>

        {cars.length > 0 && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Dostępne samochody</h2>
              <Link href="/auta" className="text-sm text-primary hover:underline">
                Zobacz wszystkie →
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cars.map((car) => (
                <Link key={car.id} href={`/auta/${car.id}`}>
                  <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                    <div className="relative aspect-video w-full bg-muted">
                      {car.imageUrl && (
                        <Image
                          src={car.imageUrl}
                          alt={`${car.brand} ${car.model}`}
                          fill
                          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {car.brand} {car.model} ({car.year})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm text-muted-foreground">
                      <p>{car.city}</p>
                      <p className="flex flex-wrap gap-x-2 text-xs">
                        {car.vehicle_type && <span>{VEHICLE_TYPE_LABELS[car.vehicle_type]}</span>}
                        {car.fuel_type && <span>· {FUEL_TYPE_LABELS[car.fuel_type]}</span>}
                        {car.seats && <span>· {car.seats} miejsc</span>}
                      </p>
                      <p className="font-semibold text-foreground">
                        {Number(car.price_per_day).toFixed(2)} zł / dzień
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          Szczegółowe zasady korzystania z serwisu znajdziesz w{" "}
          <Link href="/regulamin" className="underline">
            Regulaminie
          </Link>
          .
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
