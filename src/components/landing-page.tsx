"use client";

import Link from "next/link";
import { Inter } from "next/font/google";
import { useEffect, useRef, useState } from "react";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "900"],
});

type Tab = "owner" | "renter";

export function LandingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("owner");
  const [ownerSubmitted, setOwnerSubmitted] = useState(false);
  const [renterSubmitted, setRenterSubmitted] = useState(false);
  const [ownerSubmitting, setOwnerSubmitting] = useState(false);
  const [renterSubmitting, setRenterSubmitting] = useState(false);

  const heroRef = useRef<HTMLElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  const ownerName = useRef<HTMLInputElement>(null);
  const ownerPhone = useRef<HTMLInputElement>(null);
  const ownerEmail = useRef<HTMLInputElement>(null);
  const ownerCar = useRef<HTMLInputElement>(null);
  const ownerCity = useRef<HTMLSelectElement>(null);

  const renterName = useRef<HTMLInputElement>(null);
  const renterPhone = useRef<HTMLInputElement>(null);
  const renterEmail = useRef<HTMLInputElement>(null);
  const renterFreq = useRef<HTMLSelectElement>(null);
  const renterCity = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const el = counterRef.current;
    const heroEl = heroRef.current;
    if (!el || !heroEl) return;

    function animateCounter() {
      if (!el) return;
      const target = 2400;
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
    const name = (isOwner ? ownerName : renterName).current?.value.trim() ?? "";
    const phone = (isOwner ? ownerPhone : renterPhone).current?.value.trim() ?? "";
    const email = (isOwner ? ownerEmail : renterEmail).current?.value.trim() ?? "";
    const emailRef = isOwner ? ownerEmail : renterEmail;

    if (!name || !email) {
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
    const payload = isOwner
      ? {
          name,
          phone,
          email,
          city: ownerCity.current?.value.trim() ?? "",
          car: ownerCar.current?.value.trim() ?? "",
        }
      : {
          name,
          phone,
          email,
          city: renterCity.current?.value.trim() ?? "",
          frequency: renterFreq.current?.value ?? "",
        };

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
      className="gomambo-landing"
      style={{ "--font": inter.style.fontFamily } as React.CSSProperties}
    >
      <nav>
        <a href="#" className="logo">
          Go<span>Mambo</span>
        </a>
        <div className="nav-actions">
          <Link href="/login" className="nav-login">
            Zaloguj się
          </Link>
          <Link href="/register" className="nav-cta">
            Zostań właścicielem
          </Link>
        </div>
      </nav>

      <section id="hero" ref={heroRef}>
        <div className="hero-bg" />

        <div style={{ marginBottom: 40, display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero.png"
            style={{ width: 520, maxWidth: "90vw", display: "block" }}
            alt="GoMambo"
          />
        </div>
        <p className="hero-eyebrow">Polska · Platforma P2P · Uruchomienie Q4 2026</p>
        <h1 className="hero-headline">
          Twoje auto
          <br />
          zarabia,
          <br />
          gdy <em>ty nie jedziesz.</em>
        </h1>

        <div className="counter-block">
          <span className="counter-label">Twoje auto może zarabiać do</span>
          <span className="counter-value" id="counter" ref={counterRef}>
            0
          </span>
          <span className="counter-unit">zł / miesiąc</span>
        </div>

        <p className="hero-sub">
          GoMambo to pierwsza polska platforma peer-to-peer wynajmu aut. Łączymy
          właścicieli samochodów z osobami, które potrzebują auta — bez
          pośredników i bez zbędnych formalności.
        </p>

        <div className="split-cta">
          <Link href="/register" className="cta-card owner">
            <div className="cta-role">Dla właścicieli</div>
            <div className="cta-title">Udostępnij auto →</div>
            <div className="cta-desc">
              Zarabiaj gdy Twój samochód stoi. Ty ustalasz ceny i dostępność.
            </div>
          </Link>
          <a
            href="#waitlist"
            className="cta-card renter"
            onClick={() => setActiveTab("renter")}
          >
            <div className="cta-role">Dla najemców</div>
            <div className="cta-title">Wynajmij auto →</div>
            <div className="cta-desc">
              Sprawdzone auta od prywatnych właścicieli. Rezerwacja w 2 minuty.
            </div>
          </a>
        </div>

        <div className="scroll-hint">
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
        <p className="section-label">Jak to działa</p>
        <h2 className="section-title">Proste jak wypożyczenie od sąsiada</h2>
        <div className="steps">
          <div className="step">
            <div className="step-num">Krok 01</div>
            <div className="step-icon">🪪</div>
            <h3>Zarejestruj się</h3>
            <p>Weryfikacja tożsamości i prawa jazdy zajmuje 5 minut. Robimy to raz.</p>
          </div>
          <div className="step">
            <div className="step-num">Krok 02</div>
            <div className="step-icon">🔍</div>
            <h3>Wybierz lub dodaj auto</h3>
            <p>Przeglądaj dostępne auta w swojej okolicy lub dodaj własne i ustaw cenę.</p>
          </div>
          <div className="step">
            <div className="step-num">Krok 03</div>
            <div className="step-icon">📅</div>
            <h3>Zarezerwuj</h3>
            <p>Płatność online, ubezpieczenie w cenie. Odbiór bezpośrednio od właściciela.</p>
          </div>
          <div className="step">
            <div className="step-num">Krok 04</div>
            <div className="step-icon">💰</div>
            <h3>Jedź / Zarabiaj</h3>
            <p>Najemca jedzie, właściciel zarabia. Wypłata w 5 dni roboczych po zwrocie.</p>
          </div>
        </div>
      </section>

      <section id="waitlist">
        <div className="waitlist-inner">
          <p className="section-label">Wczesny dostęp</p>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Bądź pierwszy w Polsce
          </h2>
          <p style={{ color: "var(--gray)", fontSize: 15, lineHeight: 1.6, marginBottom: 36 }}>
            Platforma ruszy w IV kwartale 2026. Osoby z listy oczekujących jako
            pierwsze dostaną dostęp — i specjalne warunki na start.
          </p>

          <div className="waitlist-tabs">
            <button
              type="button"
              className={`tab-btn${activeTab === "owner" ? " active" : ""}`}
              onClick={() => setActiveTab("owner")}
            >
              Mam auto
            </button>
            <button
              type="button"
              className={`tab-btn${activeTab === "renter" ? " active" : ""}`}
              onClick={() => setActiveTab("renter")}
            >
              Szukam auta
            </button>
          </div>

          <div className={`tab-content${activeTab === "owner" ? " active" : ""}`}>
            <div className="form-row">
              <div className="form-group">
                <label>Imię</label>
                <input type="text" placeholder="Rafał" ref={ownerName} />
              </div>
              <div className="form-group">
                <label>Telefon</label>
                <input type="tel" placeholder="+48 500 000 000" ref={ownerPhone} />
              </div>
            </div>
            <div className="form-group">
              <label>E-mail</label>
              <input type="email" placeholder="rafal@example.com" ref={ownerEmail} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Marka auta</label>
                <input type="text" placeholder="np. Škoda, BMW, Toyota" ref={ownerCar} />
              </div>
              <div className="form-group">
                <label>Miasto</label>
                <select ref={ownerCity} defaultValue="">
                  <option value="">Wybierz miasto</option>
                  <option>Katowice</option>
                  <option>Gliwice</option>
                  <option>Zabrze</option>
                  <option>Bytom</option>
                  <option>Ruda Śląska</option>
                  <option>Sosnowiec</option>
                  <option>Tychy</option>
                  <option>Chorzów</option>
                  <option>Inne miasto</option>
                </select>
              </div>
            </div>
            {!ownerSubmitted && (
              <>
                <button
                  type="button"
                  className="submit-btn"
                  disabled={ownerSubmitting}
                  onClick={() => submitSignup("owner")}
                >
                  {ownerSubmitting ? "Zapisywanie..." : "Chcę zarabiać na swoim aucie →"}
                </button>
                <p className="form-note">
                  Bez spamu. Odezwiemy się gdy platforma będzie gotowa. Pierwsi
                  właściciele otrzymają obniżoną prowizję przez 6 miesięcy.
                </p>
              </>
            )}
            <div className="success-msg" style={{ display: ownerSubmitted ? "block" : "none" }}>
              <strong>Jesteś na liście! 🎉</strong>
              <br />
              Odezwiemy się do Ciebie jako jednego z pierwszych. Właściciele z
              listy oczekujących otrzymają{" "}
              <strong>obniżoną prowizję przez pierwsze 6 miesięcy</strong>.
            </div>
          </div>

          <div className={`tab-content${activeTab === "renter" ? " active" : ""}`}>
            <div className="form-row">
              <div className="form-group">
                <label>Imię</label>
                <input type="text" placeholder="Anna" ref={renterName} />
              </div>
              <div className="form-group">
                <label>Telefon</label>
                <input type="tel" placeholder="+48 500 000 000" ref={renterPhone} />
              </div>
            </div>
            <div className="form-group">
              <label>E-mail</label>
              <input type="email" placeholder="anna@example.com" ref={renterEmail} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Jak często wynajmujesz?</label>
                <select ref={renterFreq} defaultValue="">
                  <option value="">Wybierz</option>
                  <option>Kilka razy w roku</option>
                  <option>Raz w miesiącu</option>
                  <option>Kilka razy w miesiącu</option>
                  <option>Co tydzień lub częściej</option>
                </select>
              </div>
              <div className="form-group">
                <label>Miasto</label>
                <select ref={renterCity} defaultValue="">
                  <option value="">Wybierz miasto</option>
                  <option>Katowice</option>
                  <option>Gliwice</option>
                  <option>Zabrze</option>
                  <option>Bytom</option>
                  <option>Ruda Śląska</option>
                  <option>Sosnowiec</option>
                  <option>Tychy</option>
                  <option>Chorzów</option>
                  <option>Inne miasto</option>
                </select>
              </div>
            </div>
            {!renterSubmitted && (
              <>
                <button
                  type="button"
                  className="submit-btn"
                  disabled={renterSubmitting}
                  onClick={() => submitSignup("renter")}
                >
                  {renterSubmitting ? "Zapisywanie..." : "Chcę wynajmować auta →"}
                </button>
                <p className="form-note">
                  Bez spamu. Odezwiemy się gdy pierwsze auta będą dostępne w
                  Twoim mieście.
                </p>
              </>
            )}
            <div className="success-msg" style={{ display: renterSubmitted ? "block" : "none" }}>
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
        <div className="trust-item">
          <span className="trust-num">0 zł</span>
          <div className="trust-desc">Opłata za rejestrację</div>
        </div>
        <div className="trust-item">
          <span className="trust-num">100%</span>
          <div className="trust-desc">Ubezpieczenie w cenie</div>
        </div>
        <div className="trust-item">
          <span className="trust-num">5 dni</span>
          <div className="trust-desc">Wypłata dla właściciela</div>
        </div>
        <div className="trust-item">
          <span className="trust-num">24/7</span>
          <div className="trust-desc">Wsparcie techniczne</div>
        </div>
      </section>

      <footer>
        <a href="#" className="logo">
          Go<span>Mambo</span>
        </a>
        <p>
          © 2026 GoMambo · Polska ·{" "}
          <a href="#" style={{ color: "var(--gray)", textDecoration: "none" }}>
            Regulamin
          </a>{" "}
          ·{" "}
          <a href="#" style={{ color: "var(--gray)", textDecoration: "none" }}>
            Polityka prywatności
          </a>
        </p>
      </footer>

      <style jsx>{`
        .gomambo-landing,
        .gomambo-landing *,
        .gomambo-landing *::before,
        .gomambo-landing *::after {
          box-sizing: border-box;
        }
        .gomambo-landing * {
          margin: 0;
          padding: 0;
        }

        .gomambo-landing {
          --black: #000000;
          --white: #fafafa;
          --yellow: #f5c518;
          --yellow-dim: #c9a010;
          --gray: #888;
          --gray-light: #1a1a1a;
          --gray-mid: #2a2a2a;
          --font: "Inter", system-ui, sans-serif;
          scroll-behavior: smooth;
          background: var(--black);
          color: var(--white);
          font-family: var(--font);
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }

        /* NAV */
        .gomambo-landing nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 40px;
          background: rgba(10, 10, 10, 0.85);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .gomambo-landing .logo {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.5px;
          color: var(--white);
          text-decoration: none;
        }
        .gomambo-landing .logo :global(span) {
          color: var(--yellow);
        }
        .gomambo-landing .nav-actions {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .gomambo-landing :global(.nav-login) {
          font-size: 13px;
          font-weight: 600;
          color: var(--gray);
          text-decoration: none;
          white-space: nowrap;
        }
        .gomambo-landing :global(.nav-login:hover) {
          color: var(--white);
        }
        .gomambo-landing :global(a.nav-cta) {
          background: var(--yellow);
          color: var(--black);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.3px;
          padding: 9px 20px;
          border-radius: 6px;
          text-decoration: none;
          white-space: nowrap;
          transition: background 0.2s;
        }
        .gomambo-landing :global(a.nav-cta:hover) {
          background: var(--yellow-dim);
        }

        /* HERO */
        .gomambo-landing #hero {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 120px 40px 80px;
          position: relative;
          overflow: hidden;
          text-align: center;
        }
        .gomambo-landing .hero-bg {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse 80% 60% at 70% 50%,
            rgba(245, 197, 24, 0.07) 0%,
            transparent 70%
          );
          pointer-events: none;
        }
        .gomambo-landing .hero-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: var(--yellow);
          margin-bottom: 24px;
        }
        .gomambo-landing .hero-headline {
          font-size: clamp(42px, 7vw, 96px);
          font-weight: 900;
          line-height: 1;
          letter-spacing: -2px;
          max-width: 800px;
          margin-bottom: 32px;
        }
        .gomambo-landing .hero-headline em {
          font-style: normal;
          color: var(--yellow);
        }

        /* EARNINGS COUNTER */
        .gomambo-landing .counter-block {
          margin: 0 auto;
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          background: var(--gray-light);
          border: 1px solid rgba(245, 197, 24, 0.2);
          border-radius: 12px;
          padding: 20px 28px;
          margin-bottom: 48px;
        }
        .gomambo-landing .counter-label {
          font-size: 13px;
          color: var(--gray);
          font-weight: 500;
          white-space: nowrap;
        }
        .gomambo-landing .counter-value {
          font-size: clamp(32px, 5vw, 52px);
          font-weight: 900;
          color: var(--yellow);
          letter-spacing: -1px;
          font-variant-numeric: tabular-nums;
        }
        .gomambo-landing .counter-unit {
          font-size: 18px;
          color: var(--gray);
          font-weight: 500;
        }

        .gomambo-landing .hero-sub {
          font-size: 17px;
          color: var(--gray);
          line-height: 1.6;
          max-width: 480px;
          margin-bottom: 48px;
          text-align: center;
        }

        /* SPLIT CTA */
        .gomambo-landing .split-cta {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .gomambo-landing :global(.cta-card) {
          flex: 1;
          min-width: 220px;
          max-width: 320px;
          border-radius: 12px;
          padding: 24px;
          cursor: pointer;
          text-decoration: none;
          transition: transform 0.2s, box-shadow 0.2s;
          display: block;
        }
        .gomambo-landing :global(.cta-card:hover) {
          transform: translateY(-3px);
        }
        .gomambo-landing :global(.cta-card.owner) {
          background: var(--yellow);
          color: var(--black);
        }
        .gomambo-landing :global(.cta-card.renter) {
          background: var(--gray-light);
          color: var(--white);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .gomambo-landing :global(.cta-card .cta-role) {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          opacity: 0.6;
          margin-bottom: 8px;
        }
        .gomambo-landing :global(.cta-card.owner .cta-role) {
          color: var(--black);
        }
        .gomambo-landing :global(.cta-card .cta-title) {
          font-size: 20px;
          font-weight: 800;
          margin-bottom: 6px;
          letter-spacing: -0.3px;
        }
        .gomambo-landing :global(.cta-card .cta-desc) {
          font-size: 13px;
          opacity: 0.7;
          line-height: 1.5;
        }
        .gomambo-landing :global(.cta-card.owner .cta-desc) {
          color: var(--black);
        }

        /* SCROLL INDICATOR */
        .gomambo-landing .scroll-hint {
          position: absolute;
          bottom: 32px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--gray);
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          animation: bounce 2s infinite;
        }
        .gomambo-landing .scroll-hint svg {
          opacity: 0.4;
        }
        @keyframes bounce {
          0%,
          100% {
            transform: translateX(-50%) translateY(0);
          }
          50% {
            transform: translateX(-50%) translateY(6px);
          }
        }

        /* HOW IT WORKS */
        .gomambo-landing #how {
          padding: 100px 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .gomambo-landing .section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: var(--yellow);
          margin-bottom: 16px;
        }
        .gomambo-landing .section-title {
          font-size: clamp(28px, 4vw, 48px);
          font-weight: 900;
          letter-spacing: -1px;
          margin-bottom: 64px;
          max-width: 540px;
          line-height: 1.1;
        }
        .gomambo-landing .steps {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 2px;
        }
        .gomambo-landing .step {
          background: var(--gray-light);
          padding: 36px 28px;
          position: relative;
        }
        .gomambo-landing .step:first-child {
          border-radius: 12px 0 0 12px;
        }
        .gomambo-landing .step:last-child {
          border-radius: 0 12px 12px 0;
        }
        .gomambo-landing .step-num {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          color: var(--yellow);
          margin-bottom: 20px;
          text-transform: uppercase;
        }
        .gomambo-landing .step-icon {
          font-size: 28px;
          margin-bottom: 16px;
        }
        .gomambo-landing .step :global(h3) {
          font-size: 17px;
          font-weight: 700;
          margin-bottom: 10px;
          letter-spacing: -0.3px;
        }
        .gomambo-landing .step :global(p) {
          font-size: 14px;
          color: var(--gray);
          line-height: 1.6;
        }

        /* WAITLIST */
        .gomambo-landing #waitlist {
          padding: 100px 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          background: var(--gray-light);
        }
        .gomambo-landing .waitlist-inner {
          max-width: 560px;
        }
        .gomambo-landing .waitlist-tabs {
          display: flex;
          gap: 4px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          padding: 4px;
          margin-bottom: 40px;
          width: fit-content;
        }
        .gomambo-landing :global(.tab-btn) {
          padding: 10px 24px;
          border-radius: 7px;
          border: none;
          font-size: 14px;
          font-weight: 600;
          font-family: var(--font);
          cursor: pointer;
          transition: all 0.2s;
          background: transparent;
          color: var(--gray);
        }
        .gomambo-landing :global(.tab-btn.active) {
          background: var(--yellow);
          color: var(--black);
        }
        .gomambo-landing :global(.tab-content) {
          display: none;
        }
        .gomambo-landing :global(.tab-content.active) {
          display: block;
        }
        .gomambo-landing .form-group {
          margin-bottom: 16px;
        }
        .gomambo-landing .form-group :global(label) {
          display: block;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.5px;
          color: var(--gray);
          margin-bottom: 8px;
          text-transform: uppercase;
        }
        .gomambo-landing .form-group :global(input),
        .gomambo-landing .form-group :global(select) {
          width: 100%;
          padding: 14px 16px;
          background: var(--gray-mid);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          color: var(--white);
          font-size: 15px;
          font-family: var(--font);
          transition: border-color 0.2s;
          outline: none;
          appearance: none;
        }
        .gomambo-landing .form-group :global(input:focus),
        .gomambo-landing .form-group :global(select:focus) {
          border-color: rgba(245, 197, 24, 0.5);
        }
        .gomambo-landing .form-group :global(select option) {
          background: #1a1a1a;
        }
        .gomambo-landing .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .gomambo-landing :global(.submit-btn) {
          width: 100%;
          padding: 16px;
          background: var(--yellow);
          color: var(--black);
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 800;
          font-family: var(--font);
          cursor: pointer;
          transition: background 0.2s;
          margin-top: 8px;
          letter-spacing: -0.2px;
        }
        .gomambo-landing :global(.submit-btn:hover) {
          background: var(--yellow-dim);
        }
        .gomambo-landing :global(.submit-btn:disabled) {
          opacity: 0.7;
          cursor: default;
        }
        .gomambo-landing .form-note {
          font-size: 12px;
          color: var(--gray);
          margin-top: 12px;
          line-height: 1.6;
        }
        .gomambo-landing .success-msg {
          padding: 20px 24px;
          background: rgba(245, 197, 24, 0.1);
          border: 1px solid rgba(245, 197, 24, 0.3);
          border-radius: 10px;
          font-size: 15px;
          color: var(--white);
          line-height: 1.6;
        }
        .gomambo-landing .success-msg :global(strong) {
          color: var(--yellow);
        }

        /* TRUST BAR */
        .gomambo-landing #trust {
          padding: 64px 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 64px;
          flex-wrap: wrap;
        }
        .gomambo-landing .trust-item {
          text-align: center;
        }
        .gomambo-landing .trust-num {
          font-size: 36px;
          font-weight: 900;
          color: var(--yellow);
          letter-spacing: -1px;
          display: block;
        }
        .gomambo-landing .trust-desc {
          font-size: 13px;
          color: var(--gray);
          margin-top: 4px;
        }

        /* FOOTER */
        .gomambo-landing footer {
          padding: 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
        }
        .gomambo-landing footer .logo {
          font-size: 16px;
        }
        .gomambo-landing footer :global(p) {
          font-size: 12px;
          color: var(--gray);
        }

        /* RESPONSIVE */
        @media (max-width: 640px) {
          .gomambo-landing nav {
            padding: 16px 20px;
          }
          .gomambo-landing .logo {
            font-size: 16px;
          }
          .gomambo-landing .nav-actions {
            gap: 10px;
          }
          .gomambo-landing :global(.nav-login) {
            font-size: 12px;
          }
          .gomambo-landing :global(a.nav-cta) {
            font-size: 12px;
            padding: 8px 14px;
          }
          .gomambo-landing #hero,
          .gomambo-landing #how,
          .gomambo-landing #waitlist,
          .gomambo-landing #trust {
            padding-left: 20px;
            padding-right: 20px;
          }
          .gomambo-landing .hero-headline {
            letter-spacing: -1px;
          }
          .gomambo-landing .counter-block {
            flex-direction: column;
            align-items: center;
            gap: 4px;
            width: 100%;
            padding: 16px 20px;
          }
          .gomambo-landing .counter-label {
            white-space: normal;
            text-align: center;
          }
          .gomambo-landing .split-cta {
            flex-direction: column;
          }
          .gomambo-landing :global(.cta-card) {
            max-width: 100%;
          }
          .gomambo-landing .step:first-child,
          .gomambo-landing .step:last-child {
            border-radius: 0;
          }
          .gomambo-landing .step:first-child {
            border-radius: 12px 12px 0 0;
          }
          .gomambo-landing .step:last-child {
            border-radius: 0 0 12px 12px;
          }
          .gomambo-landing .form-row {
            grid-template-columns: 1fr;
          }
          .gomambo-landing #trust {
            gap: 32px;
          }
          .gomambo-landing footer {
            flex-direction: column;
            text-align: center;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gomambo-landing .scroll-hint {
            animation: none;
          }
          .gomambo-landing * {
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  );
}
