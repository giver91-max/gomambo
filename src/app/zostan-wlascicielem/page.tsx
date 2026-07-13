import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteFooter } from "@/components/site-footer";
import { BackButton } from "@/components/back-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EarningsCalculator } from "./earnings-calculator";

export const metadata: Metadata = {
  title: "Zostań właścicielem — wynajmuj swoje auto na GoMambo",
  description:
    "Dodaj swoje auto na GoMambo i zarabiaj, gdy z niego nie korzystasz. Ty ustalasz cenę i dostępność, dodanie ogłoszenia jest darmowe.",
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
