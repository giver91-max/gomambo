/**
 * Where to send someone who still has to verify their identity.
 *
 * Both halves are needed. The `#weryfikacja` fragment scrolls on a direct
 * visit, but browsers never send a fragment to the server, so it is lost the
 * moment middleware bounces the visitor through /login or the terms gate
 * (Next's server-action redirect drops it as well). The `krok=weryfikacja`
 * query survives those redirects inside `?redirect=`, and the profile page
 * scrolls to the verification card when it sees it.
 */
export const VERIFICATION_PATH = "/dashboard/profile?krok=weryfikacja#weryfikacja";
