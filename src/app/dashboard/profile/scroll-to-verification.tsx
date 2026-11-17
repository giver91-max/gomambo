"use client";

import { useEffect } from "react";

/**
 * Brings the verification card into view when the visit was meant for it.
 *
 * Links to it carry both `?krok=weryfikacja` and `#weryfikacja` (see
 * VERIFICATION_PATH in lib/links.ts). The fragment scrolls by itself on a
 * direct visit, but it never reaches the server, so it is gone after a hop
 * through /login or the terms gate — the query survives, and this does the
 * scrolling the browser no longer can. The card sits eighth on a long page;
 * landing at the top left people looking for it.
 */
export function ScrollToVerification() {
  useEffect(() => {
    const wanted =
      new URLSearchParams(window.location.search).get("krok") === "weryfikacja" ||
      window.location.hash === "#weryfikacja";
    if (!wanted) return;
    // After the first paint, so the cards above have their real height.
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("weryfikacja")?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return null;
}
