const TIERS = [
  {
    name: "Podstawowa",
    blurb: "Udział własny ograniczony do ustalonej kwoty przy szkodzie z Twojej winy.",
  },
  {
    name: "Standardowa",
    blurb: "Niższy udział własny, ochrona przy kradzieży i szkodach na parkingu.",
  },
  {
    name: "Pełna",
    blurb: "Zerowy udział własny, holowanie i auto zastępcze wliczone.",
  },
];

/**
 * Deliberately blunt: the paid tiers aren't live yet, so every renter is
 * booking with no protection beyond the owner's OC, and most people assume
 * the opposite. Spelling out what that means is the point — an unpleasant
 * screen now is better than an argument over a repair bill later.
 */
export function InsuranceProtectionNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg">⚠️</span>
        <p className="font-semibold text-destructive">Wynajmujesz bez dodatkowej ochrony</p>
      </div>

      <p className="text-sm text-foreground">
        Auto ma obowiązkowe OC właściciela, które pokrywa szkody wyrządzone{" "}
        <strong>innym uczestnikom ruchu</strong>. Nie pokrywa uszkodzeń wynajmowanego auta.
      </p>

      <div className="space-y-1.5 text-sm">
        <p className="font-semibold text-destructive">
          Bez dodatkowego ubezpieczenia odpowiadasz własnymi pieniędzmi za:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong className="text-foreground">każde uszkodzenie auta</strong> — od rysy na drzwiach
            po szkodę całkowitą, do pełnej wartości pojazdu
          </li>
          <li>
            <strong className="text-foreground">kradzież auta</strong> lub jego wyposażenia
          </li>
          <li>uszkodzenia opon, felg, szyb, podwozia i wnętrza</li>
          <li>holowanie, transport auta i koszty rzeczoznawcy</li>
          <li>
            <strong className="text-foreground">utratę wartości auta</strong> po naprawie oraz utracone
            zarobki właściciela za czas postoju w serwisie
          </li>
        </ul>
        <p className="text-muted-foreground">
          Kaucja zabezpiecza tylko część tych kosztów — jeśli szkoda ją przekroczy, właściciel może
          dochodzić różnicy.
        </p>
      </div>

      {!compact && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pakiety ochrony — wkrótce
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIERS.map((tier) => (
              <div key={tier.name} className="rounded-md border border-dashed p-2.5 opacity-60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{tier.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                    Wkrótce
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{tier.blurb}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Pracujemy nad pakietami ochrony z brokerem. Do czasu ich uruchomienia każdy wynajem
            odbywa się na zasadach opisanych powyżej.
          </p>
        </div>
      )}
    </div>
  );
}
