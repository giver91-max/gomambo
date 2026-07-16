import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { BackButton } from "@/components/back-button";

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
        <BackButton />

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Polityka prywatności</h1>
          <p className="text-sm text-muted-foreground">Ostatnia aktualizacja: 16 lipca 2026</p>
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
            <li>dane podane przy rejestracji konta: imię i nazwisko, adres e-mail, hasło (przechowywane w formie zaszyfrowanej), opcjonalnie numer telefonu i zdjęcie profilowe,</li>
            <li>dane ogłoszeń dodawanych przez właścicieli pojazdów: marka, model, rok, cena, miasto, opis, zdjęcia, a także dokumenty pojazdu wymagane do jego dodania (np. dowód rejestracyjny, polisa OC),</li>
            <li>
              dokument tożsamości (prawo jazdy) oraz zdjęcie selfie przesyłane w procesie
              weryfikacji tożsamości, w tym{" "}
              <strong>dane biometryczne</strong> — wynik automatycznego porównania
              wizerunku z selfie ze zdjęciem na dokumencie, wykorzystywany do
              potwierdzenia, że dokument należy do osoby zakładającej konto,
            </li>
            <li>zdjęcia wykonywane przy odbiorze i zwrocie pojazdu oraz treść wiadomości wymienianych w czacie między użytkownikami,</li>
            <li>oceny i opinie wystawiane po zakończonym wynajmie,</li>
            <li>adres IP oraz dane techniczne przeglądarki — w zakresie niezbędnym do zapewnienia bezpieczeństwa i poprawnego działania Serwisu.</li>
          </ul>
          <p>
            Dane biometryczne przetwarzane są wyłącznie za Twoją odrębną, wyraźną zgodą,
            udzielaną bezpośrednio przed przesłaniem zdjęć w procesie weryfikacji, i
            wyłącznie w celu opisanym w sekcji 3 poniżej.
          </p>
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
              lit. b i f RODO,
            </li>
            <li>
              weryfikacja tożsamości i uprawnień do kierowania pojazdami, w tym
              automatyczne porównanie wizerunku z selfie ze zdjęciem dokumentu
              tożsamości w celu przeciwdziałania oszustwom i kradzieży tożsamości — w
              zakresie danych biometrycznych: art. 9 ust. 2 lit. a RODO (Twoja wyraźna,
              odrębna zgoda), w pozostałym zakresie: art. 6 ust. 1 lit. f RODO
              (uzasadniony interes w zapewnieniu bezpieczeństwa wynajmu). Zgodę na
              przetwarzanie danych biometrycznych możesz w każdej chwili wycofać,
              kontaktując się pod adresem podanym w sekcji 9 — nie wpływa to na zgodność
              z prawem przetwarzania dokonanego przed jej wycofaniem, ale może
              uniemożliwić korzystanie z funkcji wymagających zweryfikowanego konta.
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
            <li>Google Analytics (Google Ireland Ltd.) — wyłącznie po wyrażeniu zgody na cookies analityczne, opisane w sekcji 7,</li>
            <li>Google reCAPTCHA (Google Ireland Ltd.) — ochrona formularzy przed botami i spamem, w oparciu o prawnie uzasadniony interes administratora (bezpieczeństwo Serwisu),</li>
            <li>
              Amazon Web Services (AWS), usługa Amazon Rekognition — wyłącznie do
              automatycznego porównania zdjęcia selfie ze zdjęciem dokumentu tożsamości
              podczas weryfikacji konta; przetwarzanie odbywa się w regionie
              zlokalizowanym w Unii Europejskiej, a przesłane zdjęcia nie są
              wykorzystywane przez AWS do trenowania własnych modeli.
            </li>
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
          <p>
            Zdjęcia dokumentu tożsamości i selfie oraz wynik ich automatycznego
            porównania przechowywane są przez czas niezbędny do przeprowadzenia
            weryfikacji i rozpatrzenia ewentualnej reklamacji dotyczącej jej wyniku, nie
            dłużej jednak niż przez okres istnienia konta. Po usunięciu konta lub
            wycofaniu zgody na przetwarzanie danych biometrycznych zdjęcia te są trwale
            usuwane.
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
            sesji zalogowanego użytkownika (uwierzytelnianie), oraz pliki cookies
            Google reCAPTCHA, chroniące formularze przed botami i spamem. Te pliki
            cookies nie wymagają odrębnej zgody użytkownika — są niezbędne do
            bezpiecznego działania Serwisu.
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
