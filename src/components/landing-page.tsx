"use client";

import Link from "next/link";
import { Inter } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import styles from "./landing-page.module.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "900"],
});

type Tab = "owner" | "renter";

export type LandingCar = {
  id: string;
  brand: string;
  model: string;
  year: number;
  city: string;
  pricePerDay: number;
  imageUrl: string | null;
};

export function LandingPage({
  cars,
  isLoggedIn,
}: {
  cars: LandingCar[];
  isLoggedIn: boolean;
}) {
  const addCarHref = isLoggedIn
    ? "/dashboard/cars/new"
    : { pathname: "/register", query: { next: "/dashboard/cars/new" } };

  const [activeTab, setActiveTab] = useState<Tab>("owner");
  const [ownerSubmitted, setOwnerSubmitted] = useState(false);
  const [renterSubmitted, setRenterSubmitted] = useState(false);
  const [ownerSubmitting, setOwnerSubmitting] = useState(false);
  const [renterSubmitting, setRenterSubmitting] = useState(false);

  const heroRef = useRef<HTMLElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  const ownerEmail = useRef<HTMLInputElement>(null);
  const renterEmail = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = counterRef.current;
    const heroEl = heroRef.current;
    if (!el || !heroEl) return;

    function animateCounter() {
      if (!el) return;
      const target = 3400;
      const duration = 2000;
      const start = performance.now();
      function step(now: number) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        if (el) el.textContent = Math.round(eased * target).toLocaleString("pl-PL");
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          animateCounter();
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(heroEl);
    return () => observer.disconnect();
  }, []);

  async function submitSignup(type: Tab) {
    const isOwner = type === "owner";
    const emailRef = isOwner ? ownerEmail : renterEmail;
    const email = emailRef.current?.value.trim() ?? "";

    if (!email) {
      const target = emailRef.current;
      if (target) {
        target.style.borderColor = "rgba(255,80,80,.6)";
        setTimeout(() => {
          if (target) target.style.borderColor = "";
        }, 2000);
      }
      return;
    }

    const table = isOwner ? "owner_signups" : "renter_signups";
    const payload = { email };

    const setSubmitting = isOwner ? setOwnerSubmitting : setRenterSubmitting;
    const setSubmitted = isOwner ? setOwnerSubmitted : setRenterSubmitted;

    try {
      setSubmitting(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify(payload),
        }
      );

      if (res.ok || res.status === 201) {
        setSubmitted(true);
      } else {
        throw new Error(`Błąd serwera: ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert("Coś poszło nie tak. Spróbuj ponownie.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.page}
      style={{ "--font": inter.style.fontFamily } as React.CSSProperties}
    >
      <nav>
        <Link href="/" className={styles.logo}>
          Go<span>Mambo</span>
        </Link>
        <div className={styles.navActions}>
          {isLoggedIn ? (
            <Link href="/dashboard" className={styles.navCta}>
              Panel
            </Link>
          ) : (
            <>
              <Link href="/login" className={styles.navLogin}>
                Zaloguj się
              </Link>
              <Link
                href={{ pathname: "/register", query: { next: "/dashboard/cars/new" } }}
                className={styles.navCta}
              >
                Zostań właścicielem
              </Link>
            </>
          )}
        </div>
      </nav>

      <section id="hero" ref={heroRef}>
        <div className={styles.heroBg} />

        <div style={{ marginBottom: 40, display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero.png"
            style={{ width: 520, maxWidth: "90vw", display: "block" }}
            alt="GoMambo"
          />
        </div>
        <p className={styles.heroEyebrow}>Polska · Platforma P2P · Uruchomienie IV kwartał 2026</p>
        <h1 className={styles.heroHeadline}>
          Twoje auto
          <br />
          zarabia,
          <br />
          gdy <em>Ty nie jeździsz.</em>
        </h1>

        <div className={styles.counterBlock}>
          <span className={styles.counterLabel}>Twoje auto może zarabiać do</span>
          <span className={styles.counterValue} id="counter" ref={counterRef}>
            0
          </span>
          <span className={styles.counterUnit}>zł / miesiąc</span>
        </div>

        <p className={styles.heroSub}>
          GoMambo to pierwsza polska platforma peer-to-peer wynajmu aut. Łączymy
          właścicieli samochodów z osobami, które potrzebują auta — bez
          pośredników i bez zbędnych formalności.
        </p>

        <div className={styles.splitCta}>
          <Link href={addCarHref} className={`${styles.ctaCard} ${styles.owner}`}>
            <div className={styles.ctaRole}>Dla właścicieli</div>
            <div className={styles.ctaTitle}>Udostępnij auto →</div>
            <div className={styles.ctaDesc}>
              Zarabiaj gdy Twój samochód stoi. Ty ustalasz ceny i dostępność.
            </div>
          </Link>
          <Link href="/auta" className={`${styles.ctaCard} ${styles.renter}`}>
            <div className={styles.ctaRole}>Dla najemców</div>
            <div className={styles.ctaTitle}>Wynajmij auto →</div>
            <div className={styles.ctaDesc}>
              Sprawdzone auta od prywatnych właścicieli. Rezerwacja w 2 minuty.
            </div>
          </Link>
        </div>

        <div className={styles.scrollHint}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M3 9l5 5 5-5"
              stroke="#888"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </section>

      <section id="how">
        <p className={styles.sectionLabel}>Jak to działa</p>
        <h2 className={styles.sectionTitle}>Proste jak wypożyczenie od sąsiada</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNum}>Krok 01</div>
            <div className={styles.stepIcon}>🪪</div>
            <h3>Zarejestruj się</h3>
            <p>Weryfikacja tożsamości i prawa jazdy zajmuje 5 minut. Robimy to raz.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>Krok 02</div>
            <div className={styles.stepIcon}>🔍</div>
            <h3>Wybierz lub dodaj auto</h3>
            <p>Przeglądaj dostępne auta w swojej okolicy lub dodaj własne i ustaw cenę.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>Krok 03</div>
            <div className={styles.stepIcon}>📅</div>
            <h3>Zarezerwuj</h3>
            <p>Płatność online, ubezpieczenie w cenie. Odbiór bezpośrednio od właściciela.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>Krok 04</div>
            <div className={styles.stepIcon}>💰</div>
            <h3>Jedź / Zarabiaj</h3>
            <p>Najemca jedzie, właściciel zarabia. Wypłata w 5 dni roboczych po zwrocie.</p>
          </div>
        </div>
      </section>

      <section id="waitlist">
        <div className={styles.waitlistInner}>
          <p className={styles.sectionLabel}>Wczesny dostęp</p>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 12 }}>
            Bądź pierwszy w Polsce
          </h2>
          <p style={{ color: "var(--gray)", fontSize: 15, lineHeight: 1.6, marginBottom: 36 }}>
            Platforma ruszy w IV kwartale 2026. Osoby z listy oczekujących jako
            pierwsze dostaną dostęp — i specjalne warunki na start.
          </p>

          <div className={styles.waitlistTabs}>
            <button
              type="button"
              className={`${styles.tabBtn}${activeTab === "owner" ? ` ${styles.active}` : ""}`}
              onClick={() => setActiveTab("owner")}
            >
              Mam auto
            </button>
            <button
              type="button"
              className={`${styles.tabBtn}${activeTab === "renter" ? ` ${styles.active}` : ""}`}
              onClick={() => setActiveTab("renter")}
            >
              Szukam auta
            </button>
          </div>

          <div
            className={`${styles.tabContent}${activeTab === "owner" ? ` ${styles.active}` : ""}`}
          >
            <Link href={addCarHref} className={styles.choiceCta}>
              Dodaj auto i zacznij zarabiać już teraz →
            </Link>
            <p className={styles.choiceDivider}>albo zostaw tylko e-mail, jeśli jeszcze się zastanawiasz</p>

            <div className={styles.formGroup}>
              <label>E-mail</label>
              <input type="email" placeholder="rafal@example.com" ref={ownerEmail} />
            </div>
            {!ownerSubmitted && (
              <>
                <button
                  type="button"
                  className={styles.submitBtn}
                  disabled={ownerSubmitting}
                  onClick={() => submitSignup("owner")}
                >
                  {ownerSubmitting ? "Zapisywanie..." : "Zapisz mnie na listę →"}
                </button>
                <p className={styles.formNote}>
                  Bez spamu. Odezwiemy się gdy platforma będzie gotowa. Pierwsi
                  właściciele otrzymają obniżoną prowizję przez 6 miesięcy.
                </p>
              </>
            )}
            <div
              className={styles.successMsg}
              style={{ display: ownerSubmitted ? "block" : "none" }}
            >
              <strong>Jesteś na liście! 🎉</strong>
              <br />
              Odezwiemy się do Ciebie jako jednego z pierwszych. Właściciele z
              listy oczekujących otrzymają{" "}
              <strong>obniżoną prowizję przez pierwsze 6 miesięcy</strong>.
            </div>
          </div>

          <div
            className={`${styles.tabContent}${activeTab === "renter" ? ` ${styles.active}` : ""}`}
          >
            {cars.length > 0 ? (
              <>
                <p className={styles.choiceDivider} style={{ marginTop: 0 }}>
                  Dostępne auta w tej chwili
                </p>
                <div className={styles.miniCarGrid}>
                  {cars.map((car) => (
                    <Link key={car.id} href={`/auta/${car.id}`} className={styles.miniCarCard}>
                      <div className={styles.miniCarVisual}>
                        {car.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={car.imageUrl} alt={`${car.brand} ${car.model}`} />
                        )}
                      </div>
                      <div className={styles.miniCarInfo}>
                        <div className={styles.miniCarName}>
                          {car.brand} {car.model}
                        </div>
                        <div className={styles.miniCarMeta}>
                          {car.city} · {car.pricePerDay.toFixed(0)} zł/dzień
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
                <Link href="/auta" className={styles.choiceCta} style={{ marginTop: 20 }}>
                  Zobacz wszystkie dostępne auta →
                </Link>
              </>
            ) : (
              <>
                <Link href="/auta" className={styles.choiceCta}>
                  Przeglądaj dostępne auta →
                </Link>
                <p className={styles.choiceDivider}>
                  Na razie żadne auto nie czeka jeszcze w Twojej okolicy — zostaw e-mail,
                  a powiadomimy Cię jako pierwszego
                </p>
              </>
            )}

            <div className={styles.formGroup}>
              <label>E-mail</label>
              <input type="email" placeholder="anna@example.com" ref={renterEmail} />
            </div>
            {!renterSubmitted && (
              <>
                <button
                  type="button"
                  className={styles.submitBtn}
                  disabled={renterSubmitting}
                  onClick={() => submitSignup("renter")}
                >
                  {renterSubmitting ? "Zapisywanie..." : "Powiadom mnie o nowych autach →"}
                </button>
                <p className={styles.formNote}>
                  Bez spamu. Odezwiemy się gdy pierwsze auta będą dostępne w
                  Twoim mieście.
                </p>
              </>
            )}
            <div
              className={styles.successMsg}
              style={{ display: renterSubmitted ? "block" : "none" }}
            >
              <strong>Jesteś na liście! 🎉</strong>
              <br />
              Gdy pierwsze auta pojawią się w Twoim mieście, dostaniesz SMS i
              e-mail jako pierwszy.{" "}
              <strong>Dla osób z listy — pierwsza rezerwacja bez opłaty serwisowej.</strong>
            </div>
          </div>
        </div>
      </section>

      <section id="trust">
        <div className={styles.trustItem}>
          <span className={styles.trustNum}>0 zł</span>
          <div className={styles.trustDesc}>Opłata za rejestrację</div>
        </div>
        <div className={styles.trustItem}>
          <span className={styles.trustNum}>100%</span>
          <div className={styles.trustDesc}>Ubezpieczenie w cenie</div>
        </div>
        <div className={styles.trustItem}>
          <span className={styles.trustNum}>5 dni</span>
          <div className={styles.trustDesc}>Wypłata dla właściciela</div>
        </div>
        <div className={styles.trustItem}>
          <span className={styles.trustNum}>24/7</span>
          <div className={styles.trustDesc}>Wsparcie techniczne</div>
        </div>
      </section>

      <footer>
        <Link href="/" className={styles.logo}>
          Go<span>Mambo</span>
        </Link>
        <p>
          © 2026 GoMambo · Polska ·{" "}
          <Link href="/regulamin" style={{ color: "var(--gray)", textDecoration: "none" }}>
            Regulamin
          </Link>{" "}
          ·{" "}
          <Link href="/polityka-prywatnosci" style={{ color: "var(--gray)", textDecoration: "none" }}>
            Polityka prywatności
          </Link>
        </p>
      </footer>
    </div>
  );
}
