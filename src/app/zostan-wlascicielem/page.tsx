import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isMaintenanceMode } from "@/lib/maintenance";
import { SiteFooter } from "@/components/site-footer";
import { BackButton } from "@/components/back-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SITE_NAME } from "@/lib/site";
import { EarningsCalculator } from "./earnings-calculator";

const TITLE = "Zostań właścicielem — wynajmuj auto lub flotę na GoMambo";
const DESCRIPTION =
  "Dodaj swoje auto — albo całą flotę wypożyczalni — na GoMambo. Ty ustalasz cenę i dostępność, wystawienie ogłoszenia jest darmowe, a z wynajmu dostajesz pełną swoją stawkę.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/zostan-wlascicielem" },
  // Without its own url and title, a shared link to this page inherited the
  // root layout's og:url and og:title — the preview showed (and Facebook
  // linked) the home page, not the page that recruits owners. A page's
  // openGraph REPLACES the layout's whole object, so type, locale, site name
  // and image are repeated here; keep the image in step with app/layout.tsx.
  openGraph: {
    type: "website",
    locale: "pl_PL",
    siteName: SITE_NAME,
    url: "/zostan-wlascicielem",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/hero.png", width: 1672, height: 543, alt: SITE_NAME }],
  },
  // Card type only: with no title, description or image here, Next fills the
  // Twitter tags from openGraph above instead of keeping the home page's.
  twitter: { card: "summary_large_image" },
};

const TIPS = [
  {
    icon: "📸",
    title: "Zadbaj o dobre zdjęcia",
    body: "Jasne zdjęcia z zewnątrz i wewnątrz auta budują zaufanie i przyciągają więcej zapytań.",
  },
  {
    icon: "⚡",
    title: "Odpowiadaj szybko",
    body: "Szybkie potwierdzenie rezerwacji to dla najemcy ważny sygnał, że może na Ciebie liczyć.",
  },
  {
    icon: "📋",
    title: "Ustal jasne zasady",
    body: "Opisz stan auta i zasady wynajmu, żeby uniknąć nieporozumień przy odbiorze.",
  },
  {
    icon: "🗓️",
    title: "Bądź elastyczny",
    body: "W każdej chwili możesz wstrzymać ogłoszenie (np. na urlop) bez usuwania go.",
  },
];

const HELPS = [
  {
    title: "Panel zarządzania",
    body: "Zarządzaj ceną, dostępnością i zdjęciami z telefonu lub komputera, kiedy tylko chcesz.",
  },
  {
    title: "Bezpieczeństwo",
    body: "Każdy najemca przechodzi weryfikację tożsamości i prawa jazdy, zanim wyśle zapytanie o Twoje auto.",
  },
  {
    title: "Wsparcie GoMambo",
    body: "Masz pytanie? Napisz do nas bezpośrednio na czacie w swoim panelu — odpowiadamy szybko.",
  },
];

const FACTS = [
  { value: "0 zł", label: "Opłata za dodanie ogłoszenia" },
  { value: "Ty decydujesz", label: "Cena i dostępność w Twoich rękach" },
  { value: "Pauza", label: "Wstrzymaj ogłoszenie, gdy potrzebujesz" },
  { value: "Weryfikacja", label: "Sprawdzamy tożsamość najemców" },
];

const FLEET_TERMS = [
  { value: "0 zł", label: "Za dodanie floty i za wystawienie ogłoszeń" },
  { value: "100%", label: "Twojej stawki trafia do Ciebie — prowizję dopłaca najemca" },
  { value: "Ty decydujesz", label: "Ceny i dostępność każdego auta" },
];

// Written so it stays true before and after renting opens: what the service
// will do for the company, never a claim that customers are booking today.
// "Każdą rezerwację potwierdzasz Ty" holds for every car this section leads
// to — both routes below put the cars on a company account, and a company's
// car can never be instant-booked (0042 forces instant_book off).
const FLEET_FEATURES = [
  {
    title: "Konkretne auto",
    body: "W ogłoszeniu klient zobaczy zdjęcia i opis tego konkretnego auta — i zarezerwuje właśnie je.",
  },
  {
    title: "Zapytania w jednym miejscu",
    body: "Wiadomości i prośby o rezerwację trafią do Twojego panelu. Każdą rezerwację potwierdzasz Ty, a klient zapłaci dopiero po potwierdzeniu.",
  },
  {
    title: "Płatność i kaucja online",
    body: "Klient zapłaci online za wynajem i kaucję, jeśli ją ustalisz, a wypłata trafi na Twoje konto — obsługuje to Stripe.",
  },
  {
    title: "Sprawdzeni najemcy",
    body: "Każdy najemca przechodzi weryfikację tożsamości i prawa jazdy, zanim wypożyczy auto.",
  },
];

// Answers to what owners actually ask before they add a car. Nothing here may
// promise more than the product does today: damage rules and payout timing
// are announced before renting opens (Rafał, 2026-11-07), not invented here.
const OWNER_FAQ = (maintenance: boolean) => [
  ...(maintenance
    ? [
        {
          q: "Kiedy ruszy wynajem?",
          a: "Zbieramy teraz auta od właścicieli i wypożyczalni. Katalog dla najemców otworzymy, gdy będzie w czym wybierać — Twoje zatwierdzone auto z ważnym OC i przeglądem pojawi się w nim automatycznie, a my damy Ci znać mailem.",
        },
      ]
    : []),
  {
    q: "Ile to kosztuje?",
    a: "Nic. Rejestracja i ogłoszenie są darmowe. Do Twojej ceny doliczamy najemcy opłatę serwisową GoMambo — Ty dostajesz całą swoją stawkę.",
  },
  {
    q: "Kiedy i jak dostanę pieniądze?",
    a: "Płatności uruchomimy razem z wynajmem: najemca zapłaci online kartą lub BLIK-iem, a Twoja część trafi na Twoje konto przez Stripe. Konto do wypłat skonfigurujesz w kilka minut, gdy damy znać — wtedy podamy też terminy wypłat.",
  },
  {
    q: "Co, jeśli najemca uszkodzi auto?",
    a: "Zasady dotyczące szkód i kaucji ogłosimy przed startem wynajmu. Już teraz warto zapytać swojego ubezpieczyciela, czy Twoje AC obejmuje odpłatny wynajem — wiele polis tego nie obejmuje. GoMambo nie jest ubezpieczycielem.",
  },
  {
    q: "Co muszę przygotować?",
    a: "Prawo jazdy (zdjęcie obu stron i selfie — do weryfikacji tożsamości), numer rejestracyjny, polisę OC (zdjęcie lub PDF) i kilka dobrych zdjęć auta. Wypożyczalnia zamiast prawa jazdy podaje dane firmy i odpis z CEIDG lub KRS.",
  },
];

// Asks for everything the admin's "add a car for the owner" form refuses to
// save without (registration, OC policy and both expiry dates, photos, the
// owner's confirmation they may rent the car out) plus the company account
// the cars go to, so a fleet list does not end in a round of follow-up mails.
// The admin can only add cars once that company account is verified.
const FLEET_MAILTO = `mailto:kontakt@gomambo.pl?subject=${encodeURIComponent(
  "Zgłoszenie floty — GoMambo"
)}&body=${encodeURIComponent(
  [
    "Dzień dobry,",
    "",
    "chcę wystawić flotę na GoMambo.",
    "",
    "E-mail konta firmy na GoMambo:",
    "Nazwa firmy / wypożyczalni:",
    "Miasto:",
    "Liczba aut:",
    "",
    "Lista aut (marka, model, rok, numer rejestracyjny, paliwo, skrzynia biegów, liczba miejsc, cena za dzień w zł, OC ważne do, przegląd ważny do):",
    "",
    "W załączniku przesyłam polisy OC (zdjęcie lub PDF) i zdjęcia aut.",
    "Potwierdzam, że firma może wynajmować te auta.",
    "",
    "Telefon kontaktowy:",
    "",
  ].join("\n")
)}`;

export default async function BecomeOwnerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const addCarHref = user
    ? "/dashboard/cars/new"
    : { pathname: "/register", query: { next: "/dashboard/cars/new" } };
  // A company starts from its company account, not from a driving licence:
  // sent down the private path, its staff verified themselves and listed the
  // fleet as a private person — instant book, no company shown, payouts to
  // an individual.
  const companyHref = user
    ? "/dashboard/firma"
    : { pathname: "/register", query: { next: "/dashboard/firma" } };
  const maintenance = await isMaintenanceMode();
  const faq = OWNER_FAQ(maintenance);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-tight">
          Go<span className="text-primary">Mambo</span>
        </Link>
        <Link href={addCarHref} className={buttonVariants()}>
          Zacznij teraz
        </Link>
      </header>

      <main className="mx-auto max-w-4xl space-y-16 px-6 py-10">
        <BackButton />

        <section className="space-y-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Dla właścicieli aut
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">
            Zarabiaj swoim autem,
            <br className="hidden sm:block" /> gdy z niego nie korzystasz
          </h1>
          <p className="max-w-xl text-muted-foreground sm:text-lg">
            GoMambo łączy właścicieli aut z osobami, które potrzebują
            samochodu. Ty ustalasz cenę i dostępność — dodanie ogłoszenia jest
            darmowe.
          </p>
          <Link href={addCarHref} className={buttonVariants({ size: "lg" })}>
            Dodaj swoje auto →
          </Link>
          <p className="text-sm text-muted-foreground">
            Prowadzisz wypożyczalnię lub masz flotę?{" "}
            <Link href="#flota" className="underline underline-offset-4">
              Zobacz warunki dla flot
            </Link>
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Ile możesz zarobić?</h2>
          <p className="text-muted-foreground">
            Podaj cenę za dzień wynajmu, żeby zobaczyć orientacyjny miesięczny przychód.
          </p>
          <EarningsCalculator />
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Jak zbudować udane ogłoszenie</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {TIPS.map((tip) => (
              <Card key={tip.title}>
                <CardContent className="space-y-1 py-5">
                  <p className="text-2xl">{tip.icon}</p>
                  <p className="font-semibold">{tip.title}</p>
                  <p className="text-sm text-muted-foreground">{tip.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Jak Ci pomagamy</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {HELPS.map((help) => (
              <Card key={help.title}>
                <CardContent className="space-y-1 py-5">
                  <p className="font-semibold">{help.title}</p>
                  <p className="text-sm text-muted-foreground">{help.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 rounded-xl border p-6 sm:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact.label} className="text-center">
              <p className="text-lg font-bold text-primary">{fact.value}</p>
              <p className="text-sm text-muted-foreground">{fact.label}</p>
            </div>
          ))}
        </section>

        <section id="flota" className="scroll-mt-24 space-y-8 rounded-xl border p-6 sm:p-8">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">
              Dla wypożyczalni i flot
            </p>
            <h2 className="text-2xl font-bold sm:text-3xl">
              Prowadzisz wypożyczalnię albo masz flotę?
            </h2>
            {/* Companies arrive here from a leaflet while the catalogue is
                still closed, so this must not suggest customers are already
                booking. Same switch as the "Kiedy ruszy wynajem?" answer. */}
            <p className="max-w-2xl text-muted-foreground">
              {maintenance
                ? "Gdy ruszą rezerwacje online, klienci będą mogli zarezerwować Twoje auta na GoMambo. Na razie przyjmujemy ogłoszenia — zatwierdzone auta pojawią się w katalogu automatycznie, gdy go otworzymy. Każdy samochód to osobne ogłoszenie z własnymi zdjęciami."
                : "Wystaw swoje auta na GoMambo — klienci mogą je zarezerwować online. Każdy samochód to osobne ogłoszenie z własnymi zdjęciami."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {FLEET_TERMS.map((term) => (
              <div key={term.label} className="rounded-xl border p-5 text-center">
                <p className="text-lg font-bold text-primary">{term.value}</p>
                <p className="text-sm text-muted-foreground">{term.label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {FLEET_FEATURES.map((feature) => (
              <Card key={feature.title}>
                <CardContent className="space-y-1 py-5">
                  <p className="font-semibold">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">{feature.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-4 rounded-xl bg-muted p-6">
            <h3 className="text-lg font-bold">Jak dodajemy flotę</h3>
            {/* The list is not a way around the company account: the admin
                can add cars only to a verified company, so the copy says so
                and names what to send and where. */}
            <p className="text-sm text-muted-foreground">
              Najpierw załóż konto firmy — dane z NIP i odpis z CEIDG lub KRS, bez prawa jazdy
              i selfie. Gdy zweryfikujemy firmę, dodasz auta samodzielnie w panelu. Możesz też
              wysłać listę aut na{" "}
              <a href={FLEET_MAILTO} className="underline underline-offset-4">
                kontakt@gomambo.pl
              </a>{" "}
              — dla każdego auta markę, model, rok, numer rejestracyjny, cenę za dzień oraz daty
              ważności OC i przeglądu, a w załączniku polisę OC i zdjęcia. Dodamy je za Ciebie,
              ale dopiero po weryfikacji firmy.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={companyHref} className={buttonVariants({ size: "lg" })}>
                Załóż konto firmy →
              </Link>
              <a href={FLEET_MAILTO} className={buttonVariants({ size: "lg", variant: "outline" })}>
                Wyślij nam listę aut
              </a>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Najczęstsze pytania</h2>
          <div className="space-y-3">
            {faq.map((item) => (
              <details key={item.q} className="rounded-xl border p-4">
                <summary className="cursor-pointer font-semibold">{item.q}</summary>
                <p className="pt-2 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Masz inne pytanie? Napisz na{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline underline-offset-4">
              kontakt@gomambo.pl
            </a>
            .
          </p>
        </section>

        <section className="space-y-4 rounded-xl bg-muted p-8 text-center">
          <h2 className="text-2xl font-bold">Zaczynamy?</h2>
          <p className="text-muted-foreground">Dodanie ogłoszenia zajmuje kilka minut.</p>
          <Link href={addCarHref} className={buttonVariants({ size: "lg" })}>
            Dodaj swoje pierwsze auto →
          </Link>
          <p className="text-xs text-muted-foreground">
            Pamiętaj, że przychody z wynajmu mogą podlegać opodatkowaniu zgodnie z
            polskimi przepisami. Szczegóły znajdziesz w{" "}
            <Link href="/regulamin" className="underline">
              Regulaminie
            </Link>
            .
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
