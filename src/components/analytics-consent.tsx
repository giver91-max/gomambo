"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const CONSENT_KEY = "gomambo-cookie-consent";

type Consent = "accepted" | "rejected" | null;

export function AnalyticsConsent() {
  const [consent, setConsent] = useState<Consent>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    setConsent(stored === "accepted" || stored === "rejected" ? stored : null);
    setCheckedStorage(true);
  }, []);

  function choose(value: "accepted" | "rejected") {
    localStorage.setItem(CONSENT_KEY, value);
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

      {checkedStorage && consent === null && (
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
