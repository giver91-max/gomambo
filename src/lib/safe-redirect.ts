/**
 * Turn a "where to go after logging in" value from the URL into a path on
 * THIS site, or fall back to the dashboard.
 *
 * The value arrives in links (`/login?redirect=…`, `/register?next=…`,
 * `/auth/callback?next=…`), so anyone can craft it and send it to a real
 * user. Unchecked, `?redirect=javascript:…` ran a script on gomambo.pl right
 * after a genuine login — Next's redirect() hands a non-path to
 * location.assign() — which reads the Supabase session cookies (they are not
 * httpOnly) and takes over the account, the admin's included. `?next=@evil.pl`
 * glued onto the origin in the auth callback sent people to another host.
 *
 * Only a same-origin absolute path passes: it starts with "/", not "//" or
 * "/\" (both read as another host), and has no control characters or
 * backslashes, which URL parsers strip or rewrite into exactly those forms.
 */
export function safeRedirectPath(
  raw: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  // Belt and braces: whatever the browser makes of it must stay on this origin.
  try {
    const base = "https://gomambo.invalid";
    if (new URL(raw, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
