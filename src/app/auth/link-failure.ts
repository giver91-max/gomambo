/**
 * Where to send someone whose e-mail link did not work — expired, already
 * used, or opened in another browser or on another device than the one that
 * asked for it (the PKCE code verifier lives in that browser's cookies).
 *
 * It used to be a bare /login with no word of explanation and the onward
 * target dropped. Now the page explains what happened (`blad=link`) and the
 * target survives: a password-reset link goes back to where a new one can be
 * requested, everything else to the login page, which still knows where the
 * person was heading.
 */
export function linkFailurePath(next: string): string {
  if (isPasswordResetTarget(next)) return "/zapomniane-haslo?blad=link";
  return `/login?blad=link&redirect=${encodeURIComponent(next)}`;
}

/** The reset e-mail is the only one whose target is the new-password form. */
export function isPasswordResetTarget(next: string): boolean {
  return next === "/nowe-haslo" || next.startsWith("/nowe-haslo?");
}
