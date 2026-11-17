import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Link types /auth/confirm accepts — the token_hash e-mails GoMambo actually
 * sends: sign-up confirmation (Supabase's docs call it "email"; "signup" is
 * the older name for the same thing), password reset and e-mail change.
 * Anything else is not a link we sent. Not "magiclink": GoMambo logs people
 * in with a 6-digit code, never a link. Leaving it out does NOT keep login
 * tokens away from this route, though: Supabase checks a "recovery" token
 * against the same store as login codes (both are sha224 of e-mail + code),
 * so anyone can build a working recovery link from a login code sent to
 * their own account. That is why a recovery link always lands on
 * /nowe-haslo, whatever it asks for (see RECOVERY_TARGET).
 */
export const EMAIL_LINK_TYPES = ["email", "signup", "recovery", "email_change"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/**
 * The only place a recovery link may lead. It signs the browser in, and
 * nothing ties the link to the person clicking it, so a `next` taken from it
 * would let a stranger drop someone straight into the stranger's account —
 * onto the verification card, say, to collect their driving licence and
 * selfie (login CSRF). /nowe-haslo names the account it is changing and
 * offers to log out; the reset mail never asks for anywhere else.
 */
export const RECOVERY_TARGET = "/nowe-haslo";

export function emailLinkType(raw: string | null | undefined): EmailLinkType | null {
  return (EMAIL_LINK_TYPES as readonly string[]).includes(raw ?? "") ? (raw as EmailLinkType) : null;
}

/**
 * Where to go once the link is verified.
 *
 * The templates pass either `next` (a path, e.g. the reset template's
 * next=/nowe-haslo) or `redirect_to={{ .RedirectTo }}` — the whole
 * emailRedirectTo the app gave Supabase, i.e.
 * https://www.gomambo.pl/auth/callback?next=%2Fdashboard%2Fcars%2Fnew, or the
 * bare Site URL when there was none. Only a path is ever taken from it: the
 * callback's own `next`, or the URL's path and query, never its host. A
 * recovery link takes nothing from it (see RECOVERY_TARGET).
 */
export function confirmTarget(
  type: EmailLinkType | null,
  next: string | null | undefined,
  redirectTo: string | null | undefined
): string {
  if (type === "recovery") return RECOVERY_TARGET;
  const fallback = "/dashboard";
  if (next) return safeRedirectPath(next, fallback);
  if (!redirectTo) return fallback;
  try {
    const url = new URL(redirectTo);
    const inner =
      url.pathname === "/auth/callback" || url.pathname === "/auth/confirm"
        ? url.searchParams.get("next")
        : url.pathname === "/"
          ? null
          : `${url.pathname}${url.search}`;
    return safeRedirectPath(inner, fallback);
  } catch {
    return fallback;
  }
}
