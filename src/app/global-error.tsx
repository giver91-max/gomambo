"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last resort for a crash in the root layout itself, where app/error.tsx
 * cannot help: it renders inside that layout. It replaces the whole document,
 * so it brings its own <html>, <body> and stylesheet, and sticks to plain
 * markup — nothing here should be able to fail in turn.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pl">
      <body className="antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4 font-sans">
          {/* A plain <a>, not next/link: after a root-layout crash a full
              page load is the surest way back. */}
          <a href="/" className="text-lg font-black tracking-tight">
            Go<span className="text-primary">Mambo</span>
          </a>
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-card p-6 text-center text-sm text-card-foreground ring-1 ring-foreground/10">
            <h1 className="text-base font-medium">Coś poszło nie tak</h1>
            <p className="text-muted-foreground">
              Nie udało się wyświetlić strony. Spróbuj ponownie — jeśli błąd się powtarza,
              napisz do nas na{" "}
              <a href="mailto:kontakt@gomambo.pl" className="underline underline-offset-4">
                kontakt@gomambo.pl
              </a>
              .
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => reset()}
                className="h-8 w-full rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                Spróbuj ponownie
              </button>
              <a
                href="/"
                className="flex h-8 w-full items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
              >
                Wróć na stronę główną
              </a>
            </div>
            {error.digest && (
              <p className="text-xs text-muted-foreground">Kod błędu: {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
