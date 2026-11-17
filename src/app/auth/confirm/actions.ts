"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import type { Database } from "@/types/database";
import { linkFailurePath } from "../link-failure";
import { emailLinkType, RECOVERY_TARGET } from "./link-params";

/**
 * Verify a token_hash e-mail link.
 *
 * Unlike the PKCE ?code= links handled by /auth/callback this needs nothing
 * stored in the browser, so the link works on whichever device the e-mail is
 * opened on. It runs on a button press rather than on page load: mail
 * scanners (Outlook Safe Links and the like) open every link in a message,
 * and a GET that verified would use the link up before the person clicked.
 *
 * Needing nothing from the browser is also the danger: nothing ties the link
 * to the person clicking it. Anyone can take the token from a mail sent to
 * their OWN account and hand the link to someone else, and a link that signed
 * in would put that person into the stranger's account — where /uzupelnij-dane
 * asks for a phone number and the profile for a driving licence and a selfie
 * (login CSRF). The PKCE links never had this hole: their verifier lives only
 * in the browser that asked. So:
 *  - confirming an address (sign-up, e-mail change) confirms it on any
 *    device, but never changes who the browser is signed in as. It is
 *    verified on a client that keeps no session; a browser already signed
 *    into that same account carries on, everyone else logs in with their
 *    password or a code (the login page says the address is confirmed);
 *  - a password reset has to sign in — setting the new password needs the
 *    session — so it always lands on /nowe-haslo, which names the account
 *    it is changing, never on a `next` from the link or the form (this
 *    action can be POSTed directly). A recovery link can be built from a
 *    login code to the attacker's own account (see RECOVERY_TARGET).
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = emailLinkType(String(formData.get("type") ?? ""));
  const next =
    type === "recovery"
      ? RECOVERY_TARGET
      : safeRedirectPath(String(formData.get("next") ?? ""), "/dashboard");

  if (!tokenHash || !type) {
    redirect(linkFailurePath(next));
  }

  const supabase = await createClient();

  if (type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error(`[auth/confirm] recovery link failed: ${error.code ?? "no-code"} ${error.message}`);
      // No "already signed in, carry on" here (see the same check in
      // /auth/callback): whoever is signed in on this device is not
      // necessarily the person who asked for the reset.
      redirect(linkFailurePath(next));
    }
    revalidatePath("/", "layout");
    redirect(next);
  }

  const {
    data: { user: signedIn },
  } = await supabase.auth.getUser();

  // Throwaway client: the session verifyOtp returns stays in this request's
  // memory and is revoked below, so the browser's cookies are never touched.
  const verifier = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const { data, error } = await verifier.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    console.error(`[auth/confirm] ${type} link failed: ${error.code ?? "no-code"} ${error.message}`);
    // Pressed twice in a browser that is signed in: carry on. Nothing was
    // signed in by this link, so whoever this is stays who they were.
    if (signedIn) redirect(next);
    redirect(linkFailurePath(next));
  }

  if (data.session) {
    // scope 'local' ends only this throwaway session, server-side too —
    // never the person's sessions on their other devices.
    try {
      await verifier.auth.signOut({ scope: "local" });
    } catch (signOutError) {
      console.error("[auth/confirm] could not revoke the verification session", signOutError);
    }
  }

  // The first of the two links of a secure e-mail change confirms without
  // returning a user; nothing about the browser changes either way.
  const confirmedUserId = data.user?.id ?? data.session?.user.id ?? null;
  if (signedIn && (!confirmedUserId || confirmedUserId === signedIn.id)) {
    revalidatePath("/", "layout");
    redirect(next);
  }

  const notice = type === "email_change" ? "zmiana" : "email";
  redirect(`/login?potwierdzono=${notice}&redirect=${encodeURIComponent(next)}`);
}
