import { Badge } from "@/components/ui/badge";

export type RentalParty = {
  /** The rental company operating the car, when there is one. */
  partnerName: string | null;
  /** First name of the individual owner, for peer-to-peer listings. */
  ownerName: string;
};

export type RentalRules = {
  depositAmount: number | null;
  mileageLimitKm: number | null;
  mileageOverageFeePerKm: number | null;
};

/**
 * Who is responsible for what, stated per car rather than in general.
 *
 * This replaces a notice that told every renter they were liable "do pełnej
 * wartości pojazdu" plus diminished value and the owner's lost earnings.
 * Two problems with that: the owner of the business decided liability must be
 * expressed as concrete rules, limits and exclusions rather than "everything";
 * and the last two items are genuinely contested in Polish consumer case law,
 * so asserting them to a customer as settled fact is a claim we cannot back.
 *
 * What is stated here is only what is true and knowable today: who rents the
 * car out, what GoMambo actually does, that compulsory OC does not cover the
 * rented car itself, and the concrete numbers for THIS car. Anything that
 * needs the protection product or a lawyer is absent rather than guessed.
 */
export function RentalLiabilityNotice({
  party,
  rules,
  compact = false,
}: {
  party: RentalParty;
  rules: RentalRules;
  compact?: boolean;
}) {
  const isPartner = !!party.partnerName;
  const renter = party.partnerName ?? party.ownerName;

  return (
    <div className="space-y-3 rounded-lg border p-4 text-sm">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">Kto z kim zawiera umowę</p>
          {isPartner && <Badge>Wypożyczalnia</Badge>}
        </div>
        <p className="text-muted-foreground">
          Auto wynajmuje i wydaje{" "}
          <strong className="text-foreground">{renter}</strong>
          {isPartner
            ? " — to ta firma odpowiada za stan techniczny pojazdu, jego dokumenty, ubezpieczenie i przegląd."
            : " — osoba prywatna, która udostępnia własne auto i odpowiada za jego stan techniczny, dokumenty i ubezpieczenie."}
        </p>
        <p className="text-muted-foreground">
          <strong className="text-foreground">GoMambo</strong> prowadzi platformę, obsługuje
          rezerwację i płatność oraz pobiera opłatę serwisową. Nie jest właścicielem auta,{" "}
          <strong className="text-foreground">nie jest ubezpieczycielem</strong> i nie jest stroną
          umowy najmu.
        </p>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="font-medium text-foreground">Za co odpowiadasz Ty</p>
        <p className="text-muted-foreground">
          Za auto w czasie trwania wynajmu — czyli za używanie go zgodnie z umową i oddanie w
          takim stanie, w jakim je odebrałeś, z uwzględnieniem normalnego zużycia.
        </p>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          {rules.depositAmount && rules.depositAmount > 0 ? (
            <li>
              <strong className="text-foreground">
                Kaucja {Math.round(rules.depositAmount)} zł
              </strong>{" "}
              — blokowana na karcie, nie pobierana. Wraca po zakończeniu wynajmu, jeśli auto jest
              w porządku.
            </li>
          ) : (
            <li>To auto nie ma kaucji.</li>
          )}
          {rules.mileageLimitKm ? (
            <li>
              Limit {rules.mileageLimitKm} km na dobę
              {rules.mileageOverageFeePerKm
                ? ` — powyżej limitu ${Number(rules.mileageOverageFeePerKm).toFixed(2)} zł za każdy kilometr`
                : ""}
              .
            </li>
          ) : (
            <li>Bez limitu kilometrów.</li>
          )}
          <li>Mandaty i opłaty drogowe z okresu wynajmu.</li>
        </ul>
        <p className="text-muted-foreground">
          Szczegółowe zasady, limity i wyłączenia określa umowa najmu — zawierasz ją przy odbiorze
          auta, bezpośrednio z wynajmującym. Przeczytaj ją: to ona, a nie ta strona, decyduje o
          zakresie Twojej odpowiedzialności.
        </p>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="font-medium text-foreground">Czego nie pokrywa OC</p>
        <p className="text-muted-foreground">
          Obowiązkowe OC jest przypisane do pojazdu i pokrywa szkody wyrządzone innym uczestnikom
          ruchu.{" "}
          <strong className="text-foreground">Nie pokrywa uszkodzeń wynajmowanego auta</strong> —
          te rozliczane są bezpośrednio z wynajmującym.
        </p>
      </div>

      {!compact && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">GoMambo Protection</p>
            <Badge variant="secondary">Wkrótce</Badge>
          </div>
          <p className="text-muted-foreground">
            Pracujemy nad pakietami ograniczającymi Twoją odpowiedzialność za szkody w aucie.
            Podamy zakres, limity i udział własny, gdy będą ustalone — do tego czasu obowiązują
            zasady opisane wyżej.
          </p>
        </div>
      )}

      <div className="space-y-1 border-t pt-3">
        <p className="font-medium text-foreground">Zrób zdjęcia przy odbiorze i zwrocie</p>
        <p className="text-muted-foreground">
          W panelu rezerwacji masz zakładkę na zdjęcia i stan licznika. To jedyny dowód stanu auta,
          jeśli później pojawi się spór o szkodę — działa w obie strony.
        </p>
      </div>
    </div>
  );
}
