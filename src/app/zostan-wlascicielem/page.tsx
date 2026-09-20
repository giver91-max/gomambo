import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteFooter } from "@/components/site-footer";
import { BackButton } from "@/components/back-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EarningsCalculator } from "./earnings-calculator";

export const metadata: Metadata = {
  title: "Zostań właścicielem — wynajmuj auto lub flotę na GoMambo",
  description:
    "Dodaj swoje auto — albo całą flotę wypożyczalni — na GoMambo. Ty ustalasz cenę i dostępność, dodanie ogłoszeń jest darmowe, a floty przez pierwsze 6 miesięcy nie płacą prowizji.",
  alternates: { canonical: "/zostan-wlascicielem" },
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
    body: "Najemcy częściej wybierają właścicieli, którzy szybko potwierdzają rezerwację.",
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
    body: "Najemcy mogą przejść weryfikację tożsamości, a Ty widzisz ich opinie od innych właścicieli.",
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
  { value: "0 zł", label: "Za dodanie floty" },
  { value: "0%", label: "Prowizji przez pierwsze 6 miesięcy" },
  { value: "Ty decydujesz", label: "Ceny i dostępność każdego auta" },
];

const FLEET_FEATURES = [
  {
    title: "Konkretne auto, nie klasa",
    body: "Każdy samochód to osobne ogłoszenie z prawdziwymi zdjęciami — klient rezerwuje dokładnie to auto, które widzi.",
  },
  {
    title: "Zapytania w jednym miejscu",
    body: "Wiadomości i rezerwacje od klientów spływają do Twojego panelu, bez przełączania się między kanałami.",
  },
  {
    title: "Płatność i kaucja online",
    body: "Opłata za wynajem, kaucja i wypłata na Twoje konto obsługiwane przez Stripe.",
  },
  {
    title: "Sprawdzeni najemcy",
    body: "Każdy najemca przechodzi weryfikację tożsamości i prawa jazdy, zanim wypożyczy auto.",
  },
];

const FLEET_MAILTO = `mailto:kontakt@gomambo.pl?subject=${encodeURIComponent(
  "Zgłoszenie floty — GoMambo"
)}&body=${encodeURIComponent(
  [
    "Dzień dobry,",
    "",
    "chcę wystawić flotę na GoMambo.",
    "",
    "Nazwa firmy / wypożyczalni:",
    "Miasto:",
    "Liczba aut:",
    "Lista aut (marka, model, rok, cena za dzień):",
    "",
    "Zdjęcia prześlę w załączniku lub linkiem.",
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
            GoMambo łączy właścicieli aut z osobami, które ich potrzebują. Ty
            ustalasz cenę i dostępność — dodanie ogłoszenia jest darmowe.
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
            <p className="max-w-2xl text-muted-foreground">
              Wystaw swoje auta na GoMambo i docieraj do klientów, którzy porównują oferty
              lokalnych wypożyczalni w jednym miejscu. Klient rezerwuje konkretny samochód,
              nie „klasę lub podobny” — dokładnie to, czego w klasycznych wypożyczalniach
              brakuje.
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
            <p className="text-sm text-muted-foreground">
              Możesz wprowadzić auta samodzielnie w panelu albo przesłać nam listę (marka,
              model, rok, cena za dzień, zdjęcia) — dodamy je za Ciebie i odezwiemy się, gdy
              ogłoszenia będą gotowe do zatwierdzenia.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={FLEET_MAILTO} className={buttonVariants({ size: "lg" })}>
                Zgłoś flotę →
              </a>
              <Link href={addCarHref} className={buttonVariants({ size: "lg", variant: "outline" })}>
                Dodaj auta sam w panelu
              </Link>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl bg-muted p-8 text-center">
          <h2 className="text-2xl font-bold">Gotowy, żeby zacząć?</h2>
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
