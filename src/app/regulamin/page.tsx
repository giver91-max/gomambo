import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { BackButton } from "@/components/back-button";

export const metadata: Metadata = {
  title: "Regulamin",
  alternates: { canonical: "/regulamin" },
};

export default function RegulaminPage() {
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
          <h1 className="text-2xl font-bold">Regulamin serwisu GoMambo</h1>
          <p className="text-sm text-muted-foreground">Ostatnia aktualizacja: 16 lipca 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">1. Postanowienia ogólne</h2>
          <p>
            Serwis internetowy GoMambo, dostępny pod adresem{" "}
            <a href="https://www.gomambo.pl" className="underline">
              www.gomambo.pl
            </a>{" "}
            (dalej: „Serwis&rdquo;), umożliwia właścicielom samochodów dodawanie ogłoszeń
            dotyczących udostępniania swoich pojazdów innym osobom, a osobom
            poszukującym auta — przeglądanie tych ogłoszeń.
          </p>
          <p>
            Administratorem Serwisu i usługodawcą w rozumieniu ustawy o świadczeniu usług
            drogą elektroniczną jest Rafał Płonka (dalej: „Usługodawca&rdquo;), kontakt:{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline">
              kontakt@gomambo.pl
            </a>
            . Serwis jest obecnie prowadzony w fazie rozwoju, przed formalną rejestracją
            działalności gospodarczej — dane rejestrowe firmy zostaną uzupełnione w
            niniejszym Regulaminie po jej założeniu.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">2. Zakres usług</h2>
          <p>Serwis w obecnym kształcie umożliwia:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>założenie konta właściciela pojazdu,</li>
            <li>dodawanie ogłoszeń dotyczących udostępnianych samochodów wraz ze zdjęciami,</li>
            <li>weryfikację (moderację) ogłoszeń przez administratora przed ich publikacją,</li>
            <li>publiczne przeglądanie i wyszukiwanie opublikowanych ogłoszeń.</li>
          </ul>
          <p>
            Serwis nie pośredniczy obecnie w płatnościach ani w zawieraniu umowy najmu
            pojazdu — warunki i przebieg udostępnienia samochodu ustalane są bezpośrednio
            pomiędzy właścicielem a osobą zainteresowaną, poza Serwisem. Zakres usług może
            być rozszerzany, o czym Usługodawca będzie informował w Serwisie.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">3. Konto użytkownika</h2>
          <p>
            Założenie konta wymaga podania imienia i nazwiska, adresu e-mail oraz hasła.
            Użytkownik zobowiązany jest do podawania danych zgodnych z prawdą oraz do
            zachowania poufności danych logowania. Konto jest bezpłatne.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">4. Weryfikacja tożsamości i prawa jazdy</h2>
          <p>
            Wynajęcie pojazdu za pośrednictwem Serwisu wymaga ukończenia weryfikacji
            tożsamości i uprawnień do kierowania pojazdami oraz spełniania minimalnych
            wymagań (ukończone 21 lat, posiadanie prawa jazdy kategorii B od co najmniej
            roku) — szczegóły opisane są na stronie{" "}
            <Link href="/wynajmij-auto" className="underline">
              Jak wynająć auto
            </Link>
            . Weryfikacja obejmuje przesłanie zdjęć dokumentu tożsamości (prawa jazdy)
            oraz zdjęcia selfie.
          </p>
          <p>
            Przesłane zdjęcia mogą zostać poddane automatycznej wstępnej weryfikacji, w
            tym automatycznemu porównaniu wizerunku z selfie ze zdjęciem na dokumencie.
            Niezależnie od wyniku weryfikacji automatycznej — w tym w przypadku, gdy jest
            ona niedostępna lub niejednoznaczna — zgłoszenie podlega ostatecznej
            weryfikacji przez administratora Serwisu. Przesłanie zdjęć w tym procesie
            wymaga uprzedniego wyrażenia odrębnej, dobrowolnej zgody na przetwarzanie
            danych biometrycznych, zgodnie z{" "}
            <Link href="/polityka-prywatnosci" className="underline">
              Polityką prywatności
            </Link>
            .
          </p>
          <p>
            Usługodawca zastrzega sobie prawo odmowy pozytywnej weryfikacji, zawieszenia
            lub usunięcia konta w przypadku wątpliwości co do autentyczności przesłanych
            dokumentów, zgodności zdjęcia selfie z dokumentem lub tożsamości
            użytkownika.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">5. Zasady dodawania ogłoszeń</h2>
          <p>
            Dodając ogłoszenie, właściciel oświadcza, że jest uprawniony do dysponowania
            pojazdem oraz że podane informacje (marka, model, rok produkcji, cena,
            lokalizacja, opis, zdjęcia) są zgodne ze stanem faktycznym.
          </p>
          <p>
            Każde ogłoszenie przed publikacją podlega weryfikacji przez administratora,
            który może je zatwierdzić lub odrzucić, w szczególności gdy narusza ono prawo,
            dobre obyczaje lub niniejszy Regulamin. Zdjęcia powinny przedstawiać
            rzeczywisty, zgłaszany pojazd.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">6. Odpowiedzialność</h2>
          <p>
            Usługodawca udostępnia jedynie platformę ogłoszeniową i nie jest stroną
            ewentualnej umowy zawieranej pomiędzy właścicielem pojazdu a osobą
            zainteresowaną najmem. Usługodawca dokłada starań, aby ogłoszenia były
            zweryfikowane, lecz nie gwarantuje prawdziwości treści zamieszczanych przez
            użytkowników i nie ponosi odpowiedzialności za przebieg oraz skutki ustaleń
            dokonanych między użytkownikami poza Serwisem.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">7. Reklamacje</h2>
          <p>
            Reklamacje dotyczące działania Serwisu można zgłaszać na adres{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline">
              kontakt@gomambo.pl
            </a>
            . Usługodawca rozpatruje reklamacje w terminie 14 dni od ich otrzymania.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">8. Dane osobowe</h2>
          <p>
            Zasady przetwarzania danych osobowych opisane są w{" "}
            <Link href="/polityka-prywatnosci" className="underline">
              Polityce prywatności
            </Link>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">9. Postanowienia końcowe</h2>
          <p>
            Usługodawca zastrzega sobie prawo do zmiany Regulaminu, w szczególności w
            związku z rozwojem funkcjonalności Serwisu. O zmianach użytkownicy zostaną
            poinformowani z odpowiednim wyprzedzeniem. W sprawach nieuregulowanych
            Regulaminem zastosowanie mają przepisy prawa polskiego.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
