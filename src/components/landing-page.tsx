"use client";

import Link from "next/link";
import Image from "next/image";
import { Inter } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import styles from "./landing-page.module.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "900"],
});

/**
 * The landing page is served as STATIC HTML from Vercel's CDN, so it answers
 * from the edge in tens of milliseconds and never waits for a serverless
 * function to boot. That is why it no longer receives the signed-in user as
 * props: reading the session on the server made the page dynamic, and the
 * first visit after a quiet spell sat through a cold start.
 *
 * The one thing that depends on who you are — the nav buttons — is worked out
 * here instead. The HTML ships the signed-out buttons, which is right for
 * nearly everyone who lands here; a signed-in visitor sees them swap to their
 * name a moment after the page appears. getSession() reads the session cookie
 * locally, with no network round trip, so the swap is near-immediate.
 *
 * The Supabase client is imported LAZILY and only when a session cookie is
 * present. A static import put the whole client — about 67 kB of JavaScript —
 * on the landing page for every visitor, to answer a question whose answer is
 * "nobody is signed in" for almost all of them.
 */
export function LandingPage() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const isLoggedIn = displayName !== null;

  useEffect(() => {
    // Only a signed-in browser carries a Supabase auth cookie (sb-<ref>-auth-token,
    // chunked as .0/.1 when long). No cookie, nothing to do, nothing to download.
    const hasSession = document.cookie
      .split("; ")
      .some((part) => /^sb-[^=]+-auth-token(\.\d+)?=/.test(part));
    if (!hasSession) return;

    let cancelled = false;
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || cancelled) return;
      // Show something straight away, then the name from the profile — the
      // same source the server used, in case it was edited after sign-up.
      setDisplayName(String(user.user_metadata?.full_name || "Panel"));
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled && profile?.full_name) setDisplayName(profile.full_name);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const heroRef = useRef<HTMLElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = counterRef.current;
    const heroEl = heroRef.current;
    if (!el || !heroEl) return;

    function animateCounter() {
      if (!el) return;
      const target = 5000;
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
            <Link href="/dashboard" className={`${styles.navCta} ${styles.navCtaName}`}>
              {displayName}
            </Link>
          ) : (
            <>
              <Link href="/login" className={styles.navLogin}>
                Zaloguj się
              </Link>
              <Link href="/zostan-wlascicielem" className={styles.navCta}>
                Zostań właścicielem
              </Link>
            </>
          )}
        </div>
      </nav>

      <section id="hero" ref={heroRef}>
        <div className={styles.heroBg} />

        <div style={{ marginBottom: 40, display: "flex", justifyContent: "center" }}>
          <Image
            src="/hero.png"
            width={1672}
            height={543}
            sizes="(max-width: 600px) 90vw, 520px"
            style={{ width: 520, maxWidth: "90vw", height: "auto", display: "block" }}
            alt="GoMambo — wypożyczalnia samochodów P2P"
            priority
          />
        </div>
        <p className={styles.heroEyebrow}>Polska · Platforma P2P · Wypożyczalnie w jednym miejscu</p>
        <h1 className={styles.heroHeadline}>
          Twoje auto
          <br />
          zarabia,
          <br />
          gdy <em>Ty nie jeździsz.</em>
        </h1>

        <div className={styles.counterBlock}>
          <span className={styles.counterLabel}>Twoje auto może zarabiać nawet</span>
          <span className={styles.counterValue} id="counter" ref={counterRef}>
            0
          </span>
          <span className={styles.counterUnit}>zł / miesiąc</span>
        </div>

        <p className={styles.heroSub}>
          GoMambo to internetowa wypożyczalnia samochodów — działamy jako
          platforma P2P i łączymy oferty lokalnych wypożyczalni w jednym
          miejscu, żebyś mógł porównać i wybrać dokładnie to auto, które Ci
          pasuje.
        </p>

        <div className={styles.splitCta}>
          <Link href="/zostan-wlascicielem" className={`${styles.ctaCard} ${styles.owner}`}>
            <div className={styles.ctaRole}>Dla właścicieli</div>
            <div className={styles.ctaTitle}>Udostępnij auto →</div>
            <div className={styles.ctaDesc}>
              Zarabiaj gdy Twój samochód stoi. Ty ustalasz ceny i dostępność.
            </div>
          </Link>
          <Link href="/wynajmij-auto" className={`${styles.ctaCard} ${styles.renter}`}>
            <div className={styles.ctaRole}>Dla najemców</div>
            <div className={styles.ctaTitle}>Wynajmij auto →</div>
            <div className={styles.ctaDesc}>
              Sprawdzone auta od lokalnych wypożyczalni i właścicieli. Rezerwacja w 2 minuty.
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

      <section id="difference">
        <p className={styles.sectionLabel}>Różnica</p>
        <h2 className={styles.sectionTitle}>
          Nie wynajmujesz klasy. Wynajmujesz TO auto.
        </h2>
        <p className={styles.diffIntro}>
          W tradycyjnej wypożyczalni rezerwujesz kategorię — &bdquo;kompakt lub
          podobny&rdquo; — i dostajesz cokolwiek akurat stoi na parkingu. W
          GoMambo widzisz dokładnie ten samochód, który wynajmiesz: ten kolor,
          ten silnik, to konkretne wyposażenie. To, co widzisz w ogłoszeniu,
          to auto, którym pojedziesz.
        </p>
        <div className={styles.diffGrid}>
          <div className={`${styles.diffCard} ${styles.old}`}>
            <div className={styles.diffLabel}>Tradycyjna wypożyczalnia</div>
            <div className={styles.diffMain}>&bdquo;Ford Focus lub podobny&rdquo;</div>
            <ul>
              <li>Rezerwujesz kategorię, nie konkretny samochód</li>
              <li>Kolor, silnik i wyposażenie — niespodzianka na miejscu</li>
            </ul>
          </div>
          <div className={`${styles.diffCard} ${styles.new}`}>
            <div className={styles.diffLabel}>GoMambo</div>
            <div className={styles.diffMain}>Ten konkretny samochód</div>
            <ul>
              <li>Widzisz realne zdjęcia auta, zanim zarezerwujesz</li>
              <li>Znasz kolor, silnik i wyposażenie z góry</li>
              <li>To, co widzisz, to dostajesz — zero niespodzianek</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="how">
        <p className={styles.sectionLabel}>Jak to działa</p>
        <h2 className={styles.sectionTitle}>Wynajem w 4 krokach</h2>
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
            <p>Płatność online. Odbiór bezpośrednio od właściciela.</p>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>Krok 04</div>
            <div className={styles.stepIcon}>💰</div>
            <h3>Jedź / Zarabiaj</h3>
            <p>Najemca jedzie, właściciel zarabia. Wypłata w 5 dni roboczych po zwrocie.</p>
          </div>
        </div>
      </section>

      <section id="usecases">
        <p className={styles.sectionLabel}>Dla właścicieli</p>
        <h2 className={styles.sectionTitle}>
          Twoje auto może zarabiać częściej, niż myślisz
        </h2>
        <div className={styles.useCases}>
          <div className={styles.useCase}>
            <div className={styles.useCaseIcon}>✈️</div>
            <h3>Wyjeżdżasz na wakacje</h3>
            <p>
              Zamiast płacić za parking na lotnisku, udostępnij auto na czas
              wyjazdu — zamiast tracić, zarabiasz.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIcon}>🚗</div>
            <h3>Masz drugie auto</h3>
            <p>
              Jeśli jeden z Twoich samochodów rzadko wyjeżdża z garażu,
              udostępnij go innym i zamień stojący kapitał w dochód.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIcon}>🩹</div>
            <h3>Jesteś na zwolnieniu (L4)</h3>
            <p>
              Nie prowadzisz przez jakiś czas? Auto nie musi stać bezczynnie —
              może zarabiać zamiast Ciebie.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIcon}>🏢</div>
            <h3>Masz flotę lub wypożyczalnię</h3>
            <p>
              Wystaw wszystkie auta w jednym miejscu i docieraj do klientów, którzy
              porównują oferty na GoMambo. Ceny ustalasz Ty, dodanie floty jest
              darmowe.
            </p>
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
          <div className={styles.trustDesc}>Zweryfikowana tożsamość</div>
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
