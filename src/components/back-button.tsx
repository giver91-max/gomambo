"use client";

import { useRouter } from "next/navigation";

export function BackButton({
  label = "Wstecz",
  fallbackHref = "/",
}: {
  label?: string;
  /** Where to go when there is nothing to go back to. */
  fallbackHref?: string;
}) {
  const router = useRouter();

  function goBack() {
    // A page opened from an e-mail is the first entry in its tab, and
    // router.back() then does nothing at all. document.referrer is no help
    // here: mail apps and webmail strip it even when there is history.
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-block w-fit self-start text-left text-sm text-muted-foreground hover:underline"
    >
      ← {label}
    </button>
  );
}
