import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Polityka prywatności",
  alternates: { canonical: "/polityka-prywatnosci" },
};

export default function PolitykaPrywatnosciPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-tight">
          Go<span className="text-primary">Mambo</span>
        </Link>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Polityka prywatności</h1>
          <p className="text-sm text-muted-foreground">Ostatnia aktualizacja: 6 lipca 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">1. Administrator danych</h2>
          <p>
            Administratorem danych osobowych przetwarzanych w serwisie GoMambo (
            <a href="https://www.gomambo.pl" className="underline">
              www.gomambo.pl
            </a>
            ) jest Rafał Płonka, kontakt:{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline">
              kontakt@gomambo.pl
            </a>
            . Serwis jest obecnie prowadzony przed formalną rejestracją działalności
            gospodarczej — pełne dane rejestrowe zostaną uzupełnione po jej założeniu.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">2. Jakie dane przetwarzamy</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>dane podane przy rejestracji konta: imię i nazwisko, adres e-mail, hasło (przechowywane w formie zaszyfrowanej),</li>
            <li>dane ogłoszeń dodawanych przez właścicieli pojazdów: marka, model, rok, cena, miasto, opis, zdjęcia,</li>
            <li>adres IP oraz dane techniczne przeglądarki — w zakresie niezbędnym do zapewnienia bezpieczeństwa i poprawnego działania Serwisu.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">3. Cele i podstawy prawne przetwarzania</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              założenie i obsługa konta oraz publikacja ogłoszeń — art. 6 ust. 1 lit. b
              RODO (wykonanie umowy, czyli świadczenie usług Serwisu),
            </li>
            <li>
              weryfikacja ogłoszeń, zapobieganie nadużyciom oraz wysyłka powiadomień
              e-mail związanych z kontem i ogłoszeniami — art. 6 ust. 1 lit. f RODO
              (prawnie uzasadniony interes administratora),
            </li>
            <li>
              rozpatrywanie reklamacji i korespondencja z użytkownikiem — art. 6 ust. 1
              lit. b i f RODO.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">4. Odbiorcy danych</h2>
          <p>Dane są powierzane następującym podmiotom przetwarzającym, wspierającym działanie Serwisu:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Supabase — baza danych, uwierzytelnianie użytkowników i przechowywanie zdjęć,</li>
            <li>Vercel — hosting i infrastruktura serwerowa Serwisu,</li>
            <li>Resend — wysyłka wiadomości e-mail (powiadomienia o rejestracji i nowych ogłoszeniach),</li>
            <li>Google Analytics (Google Ireland Ltd.) — wyłącznie po wyrażeniu zgody na cookies analityczne, opisane w sekcji 7.</li>
          </ul>
          <p>
            Dostawcy ci mogą przetwarzać dane na serwerach zlokalizowanych poza
            Europejskim Obszarem Gospodarczym (w szczególności w USA). W takich
            przypadkach przekazanie danych odbywa się w oparciu o standardowe klauzule
            umowne zatwierdzone przez Komisję Europejską lub inny odpowiedni mechanizm
            przewidziany przepisami RODO.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">5. Okres przechowywania danych</h2>
          <p>
            Dane konta i ogłoszeń przechowywane są przez czas istnienia konta w Serwisie.
            Po usunięciu konta dane są usuwane lub anonimizowane, chyba że ich dalsze
            przechowywanie jest wymagane przepisami prawa.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">6. Prawa użytkownika</h2>
          <p>W związku z przetwarzaniem danych osobowych przysługuje Ci prawo do:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>dostępu do swoich danych oraz otrzymania ich kopii,</li>
            <li>sprostowania (poprawienia) danych,</li>
            <li>usunięcia danych („prawo do bycia zapomnianym&rdquo;),</li>
            <li>ograniczenia przetwarzania,</li>
            <li>przenoszenia danych,</li>
            <li>wniesienia sprzeciwu wobec przetwarzania opartego na uzasadnionym interesie,</li>
            <li>
              wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (UODO), jeśli
              uznasz, że przetwarzanie narusza przepisy RODO.
            </li>
          </ul>
          <p>
            W celu realizacji powyższych praw skontaktuj się pod adresem{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline">
              kontakt@gomambo.pl
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">7. Pliki cookies</h2>
          <p>
            Serwis wykorzystuje niezbędne pliki cookies, odpowiedzialne za utrzymanie
            sesji zalogowanego użytkownika (uwierzytelnianie). Te pliki cookies nie
            wymagają odrębnej zgody użytkownika.
          </p>
          <p>
            Za Twoją zgodą Serwis korzysta również z plików cookies Google Analytics,
            które pomagają nam analizować ruch w Serwisie (liczbę odwiedzin,
            odwiedzane podstrony, źródła wizyt). Zgodę można wyrazić lub odrzucić w
            banerze wyświetlanym przy pierwszej wizycie w Serwisie; brak zgody nie
            ogranicza dostępu do żadnych funkcji Serwisu. Więcej informacji o
            przetwarzaniu danych przez Google znajduje się w{" "}
            <a
              href="https://policies.google.com/privacy"
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              polityce prywatności Google
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">8. Bezpieczeństwo danych</h2>
          <p>
            Hasła użytkowników przechowywane są w formie zaszyfrowanej. Dostęp do danych
            w bazie ograniczony jest regułami bezpieczeństwa (Row Level Security),
            zapewniającymi, że użytkownik ma dostęp wyłącznie do własnych danych, a dane
            ogłoszeń oczekujących na zatwierdzenie widoczne są jedynie dla ich właściciela
            oraz administratora.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">9. Kontakt</h2>
          <p>
            W sprawach dotyczących ochrony danych osobowych napisz na adres{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline">
              kontakt@gomambo.pl
            </a>
            .
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
