"use client";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export function getRecaptchaToken(action: string): Promise<string | null> {
  if (!SITE_KEY || !window.grecaptcha) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    window.grecaptcha!.ready(() => {
      window
        .grecaptcha!.execute(SITE_KEY, { action })
        .then(resolve)
        .catch(() => resolve(null));
    });
  });
}
