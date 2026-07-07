"use client";

import Script from "next/script";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CONSENT_COOKIE, type Consent } from "@/lib/consent";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function AnalyticsConsent({ initialConsent }: { initialConsent: Consent }) {
  const [consent, setConsent] = useState<Consent>(initialConsent);

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
