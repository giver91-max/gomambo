import type { AuthError } from "@supabase/supabase-js";

/**
 * What a form says when its server action never answered: the connection
 * dropped, or the page was opened before a deploy and its action id no longer
 * exists on the server ("Failed to find Server Action"). Without a catch the
 * rejected transition reaches the error boundary and takes the whole form —
 * and everything typed into it — with it.
 */
export const SUBMIT_FAILED_MESSAGE =
  "Nie udało się wysłać formularza. Sprawdź połączenie z internetem i spróbuj ponownie — a jeśli to nie pomoże, odśwież stronę.";

/** Supabase refused to send another e-mail yet (per address, or per client IP). */
export function isAuthRateLimit(error: Pick<AuthError, "code" | "status">): boolean {
  return (
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    error.status === 429
  );
}

/**
 * Supabase never got to answer about the account itself: its own failure
 * (e.g. the mail could not be handed to SMTP) or no response at all (auth-js
 * reports a failed fetch with status 0).
 */
export function isAuthServiceFailure(error: Pick<AuthError, "status">): boolean {
  return !error.status || error.status >= 500;
}

/**
 * Polish text for an error Supabase Auth returned.
 *
 * GoTrue's own messages are English ("For security purposes, you can only
 * request this after 42 seconds.", "New password should be different from the
 * old password.") and used to reach the page verbatim. Mapped on error.code,
 * which auth-js 2.x fills in from the API; anything not listed gets the
 * caller's fallback. The original is logged so the cause can still be traced
 * in the Vercel logs.
 *
 * Server-side only, and only for errors that may be shown as they are: the
 * login-code, password-reset and resend actions decide first what they can
 * say without revealing whether an address has an account.
 */
export function authErrorMessage(
  error: Pick<AuthError, "code" | "message" | "status">,
  fallback: string
): string {
  console.error(`[auth] ${error.code ?? "no-code"} (${error.status ?? "no-status"}): ${error.message}`);

  switch (error.code) {
    case "over_email_send_rate_limit":
      return "Wysłaliśmy w krótkim czasie zbyt wiele wiadomości. Odczekaj minutę i spróbuj ponownie.";
    case "over_request_rate_limit":
      return "Zbyt wiele prób w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.";
    case "email_address_invalid":
      return "Ten adres e-mail wygląda na nieprawidłowy. Sprawdź go i spróbuj ponownie.";
    case "email_address_not_authorized":
      return "Nie możemy teraz wysłać wiadomości na ten adres. Napisz do nas: kontakt@gomambo.pl.";
    case "weak_password":
      return "To hasło jest za słabe. Użyj co najmniej 8 znaków, najlepiej liter i cyfr, i nie używaj hasła z innej strony.";
    case "same_password":
      return "Nowe hasło musi być inne niż dotychczasowe.";
    case "email_exists":
    case "user_already_exists":
      return "Ten adres e-mail ma już konto. Zaloguj się albo użyj „Nie pamiętasz hasła?”.";
    case "signup_disabled":
      return "Rejestracja jest chwilowo wyłączona. Spróbuj ponownie później.";
    case "email_not_confirmed":
      return "Adres e-mail nie jest jeszcze potwierdzony.";
    case "otp_expired":
      return "Kod albo link wygasł. Poproś o nowy.";
    case "session_not_found":
    case "session_expired":
    case "reauthentication_needed":
      return "Sesja wygasła. Zaloguj się ponownie albo poproś o nowy link.";
    case "captcha_failed":
      return "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie.";
    default:
      if (error.status === 429) {
        return "Zbyt wiele prób w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.";
      }
      return fallback;
  }
}
