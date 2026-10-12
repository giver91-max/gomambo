"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CONSENT_COOKIE, type Consent } from "@/lib/consent";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

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

  useEffect(() => {
    setConsent(readConsentCookie());
  }, []);

  function choose(value: "accepted" | "rejected") {
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    setConsent(value);
  }

  return (
    <>
      {GA_MEASUREMENT_ID && consent === "accepted" && (
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
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg">
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
      )}
    </>
  );
}
