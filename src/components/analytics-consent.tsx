"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CONSENT_COOKIE, type Consent } from "@/lib/consent";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

// Pages whose address is itself a secret: a token_hash e-mail link
// (/auth/confirm — a password-reset one signs in whoever presses the button,
// and stays usable until it expires) and a phone verification session
// (/verify-handoff/<token>). Google Analytics records the full address of
// every page it sees, query string included, where anyone with access to the
// property can read it — so it never sees these.
const PRIVATE_PATH_PREFIXES = ["/auth/", "/verify-handoff/"];

function isPrivatePath(pathname: string | null): boolean {
  return PRIVATE_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
}

function readConsentCookie(): Consent {
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const value = match?.slice(CONSENT_COOKIE.length + 1);
  return value === "accepted" || value === "rejected" ? value : null;
}

/**
 * The consent decision is read HERE, in the browser, not passed down from the
 * root layout.
 *
 * It used to be read on the server with cookies() in app/layout.tsx — and a
 * single cookies() call in the root layout opts every route in the app out of
 * static rendering. All 48 pages, the terms and the privacy policy included,
 * were rendered by a serverless function on every request and never cached at
 * the CDN, so the first visit after a quiet spell always waited for that
 * function to boot. That cold start is what made the first load of
 * gomambo.pl slow.
 *
 * `undefined` means "not read yet". Nothing renders until the cookie has been
 * read, so someone who already chose never sees the banner flash up, and the
 * server and first client render agree (no hydration mismatch).
 */
export function AnalyticsConsent() {
  const [consent, setConsent] = useState<Consent | undefined>(undefined);
  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerHeight, setBannerHeight] = useState(0);
  const privatePage = isPrivatePath(usePathname());

  useEffect(() => {
    setConsent(readConsentCookie());
  }, []);

  // Those pages are only ever opened with a full page load (from an e-mail,
  // a QR code, a new tab), so not loading the script there covers them. GA
  // loaded earlier in the visit also reports in-app navigation, though, so a
  // move onto one of them later switches it off with Google's documented
  // opt-out flag, and back on when leaving.
  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`] = privatePage;
  }, [privatePage]);

  // The banner is fixed to the bottom of the screen, so until a choice is made
  // it sat over the end of every page — the footer links (Regulamin, Polityka
  // prywatności, Kontakt) included — and on pages exactly one screen tall
  // there was nothing to scroll them out from under it. A spacer of the
  // banner's height at the end of the page lets everything scroll above it.
  // Measured, not hard-coded: the banner wraps to a different height on every
  // screen width.
  useEffect(() => {
    const banner = bannerRef.current;
    if (consent !== null || !banner) return;
    const observer = new ResizeObserver(() => setBannerHeight(banner.offsetHeight));
    observer.observe(banner);
    return () => observer.disconnect();
  }, [consent]);

  function choose(value: "accepted" | "rejected") {
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    setConsent(value);
  }

  return (
    <>
      {GA_MEASUREMENT_ID && consent === "accepted" && !privatePage && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_MEASUREMENT_ID}');
            `}
          </Script>
        </>
      )}

      {consent === null && (
        <>
          {/* In the page flow, after everything else: see the effect above. */}
          <div aria-hidden="true" style={{ height: bannerHeight }} />
          <div
            ref={bannerRef}
            className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg"
          >
            <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                Używamy plików cookies niezbędnych do działania Serwisu oraz, za Twoją
                zgodą, plików analitycznych (Google Analytics), które pomagają nam
                rozwijać GoMambo. Szczegóły w{" "}
                <a href="/polityka-prywatnosci" className="underline">
                  Polityce prywatności
                </a>
                .
              </p>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => choose("rejected")}>
                  Tylko niezbędne
                </Button>
                <Button size="sm" onClick={() => choose("accepted")}>
                  Akceptuję
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
