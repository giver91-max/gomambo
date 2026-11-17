"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { escapeHtml } from "@/lib/html";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { authErrorMessage, isAuthRateLimit, isAuthServiceFailure } from "./auth-errors";

export type AuthActionState = {
  error: string | null;
  success?: boolean;
  /** signIn: the password was right, but the address was never confirmed. */
  unconfirmed?: boolean;
  /** requestLoginCode: shown on the code screen instead of "we sent a code". */
  notice?: string;
};

async function requestOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host");
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  return headersList.get("origin") ?? `${proto}://${host}`;
}

/** Where an e-mail link lands: /auth/callback, which then goes on to `next`. */
function callbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const next = safeRedirectPath(String(formData.get("next") ?? ""));
  const acceptTerms = formData.get("acceptTerms") === "on";
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;
  const refRaw = String(formData.get("ref") ?? "").trim();
  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refRaw);
  const referredBy = isValidUuid ? refRaw : null;

  if (!email || !password || !fullName) {
    return { error: "Wypełnij wszystkie pola." };
  }
  if (password.length < 8) {
    return { error: "Hasło musi mieć co najmniej 8 znaków." };
  }
  if (!acceptTerms) {
    return { error: "Musisz zaakceptować regulamin i politykę prywatności." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "register"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const origin = await requestOrigin();

  const supabase = await createClient();
  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        terms_accepted_at: new Date().toISOString(),
        // Copied onto the profile by handle_new_user (0051), so it is on
        // record which Regulamin this account agreed to.
        terms_version: CURRENT_TERMS_VERSION,
        ...(referredBy ? { referred_by: referredBy } : {}),
      },
      emailRedirectTo: callbackUrl(origin, next),
    },
  });

  if (error) {
    return {
      error: authErrorMessage(error, "Nie udało się założyć konta. Spróbuj ponownie za chwilę."),
    };
  }

  // With e-mail confirmation on, Supabase answers a sign-up for an address
  // that already has a confirmed account with a stand-in user (random id, no
  // identities) and sends nothing, so the form cannot be used to find out who
  // has an account. An address that signed up earlier but never confirmed
  // just gets its confirmation mail again and keeps its old created_at.
  // Neither is a new registration: the admin got a "Nowa rejestracja" alert
  // whose panel link pointed at a user that does not exist. The person sees
  // the same "check your inbox" page either way, and that page tells someone
  // who already has an account what to do instead.
  const newUser = signUpData.user;
  const isNewAccount =
    !!newUser &&
    (newUser.identities?.length ?? 0) > 0 &&
    Date.now() - new Date(newUser.created_at).getTime() < 10 * 60 * 1000;

  if (newUser && isNewAccount) {
    await sendNotificationEmail({
      to: "user@gomambo.pl",
      subject: `Nowa rejestracja: ${fullName}`,
      html: `
        <p>Nowy użytkownik zarejestrował się w GoMambo.</p>
        <ul>
          <li><strong>Imię i nazwisko:</strong> ${escapeHtml(fullName)}</li>
          <li><strong>Email:</strong> ${escapeHtml(email)}</li>
        </ul>
      `,
    });

    const admin = createAdminClient();
    await admin.from("admin_notifications").insert({
      type: "new_registration",
      body: `Nowy użytkownik: ${fullName} (${email})`,
      link: `/admin/users/${newUser.id}`,
    });

    if (referredBy) {
      const { data: referrerProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", referredBy)
        .single();
      await admin.from("admin_notifications").insert({
        type: "new_referral",
        body: `${fullName} zarejestrował się z polecenia: ${referrerProfile?.full_name || "nieznany użytkownik"}`,
        link: `/admin/users/${referredBy}`,
      });
    }
  }

  redirect(`/register/sprawdz-email?next=${encodeURIComponent(next)}`);
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""));
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!email || !password) {
    return { error: "Podaj email i hasło." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "login"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // GoTrue checks the password before it checks confirmation, so only
    // someone who knows the password ever sees this — it tells nobody else
    // whether the address has an account. It used to read "wrong e-mail or
    // password", which sent people with the right password in circles.
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "Ten adres e-mail nie został jeszcze potwierdzony, więc nie możemy Cię zalogować. Wyślij sobie nowy link aktywacyjny i kliknij go — konto będzie aktywne, a hasło zostaje to samo.",
        unconfirmed: true,
      };
    }
    if (isAuthRateLimit(error) || isAuthServiceFailure(error)) {
      return {
        error: authErrorMessage(error, "Nie udało się zalogować. Spróbuj ponownie za chwilę."),
      };
    }
    return { error: "Nieprawidłowy email lub hasło." };
  }

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

/**
 * A new confirmation link for an address that signed up but never clicked
 * the first one (those links expire after a day).
 */
export async function resendConfirmation(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeRedirectPath(String(formData.get("next") ?? ""));
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!email) {
    return { error: "Podaj adres e-mail." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "resend_confirmation"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const origin = await requestOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: callbackUrl(origin, next) },
  });

  if (error) {
    if (isAuthRateLimit(error)) {
      return {
        error:
          "Link można wysłać ponownie najwyżej raz na minutę. Jeśli wiadomość już dotarła, użyj linku z niej — albo odczekaj chwilę i spróbuj jeszcze raz.",
      };
    }
    if (error.code === "email_address_invalid" || isAuthServiceFailure(error)) {
      return {
        error: authErrorMessage(error, "Nie udało się wysłać linku. Spróbuj ponownie za chwilę."),
      };
    }
    // An address with no account, or one that is already confirmed, gets the
    // same answer as a sent link — the page must not tell them apart.
    console.error(`[auth] resend: ${error.code ?? "no-code"} ${error.message}`);
  }

  return { error: null, success: true };
}

export async function requestLoginCode(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""));
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!email) {
    return { error: "Podaj adres e-mail." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "login_otp_request"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const origin = await requestOrigin();
  const supabase = await createClient();
  // shouldCreateUser: false — a code should only ever log an existing user
  // in. Letting it silently create accounts would skip the terms-acceptance
  // checkbox and full_name collection that signUp() normally requires.
  //
  // emailRedirectTo: an account that never confirmed its address gets
  // Supabase's "Confirm signup" e-mail here instead of the code. Its link now
  // comes back through /auth/callback, which signs the person in and goes on
  // to where they were heading; before, it pointed at the bare Site URL,
  // where nothing exchanges the code.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: callbackUrl(origin, redirectTo) },
  });

  if (error) {
    // Still move on to the code screen: a code from a minute ago keeps
    // working. This does set an address with an account apart from one
    // without (a missing account never reaches the per-address limit), but
    // Supabase's public endpoint gives the same 429 to anyone holding the
    // public anon key, so hiding it here would protect nothing and only leave
    // the person waiting for a code that is not coming.
    if (isAuthRateLimit(error)) {
      return {
        error: null,
        success: true,
        notice:
          "Tym razem nie wysłaliśmy kodu — wiadomość z kodem można wysłać najwyżej raz na minutę. Jeśli masz kod z poprzedniej wiadomości, wpisz go poniżej, albo odczekaj chwilę i poproś o nowy.",
      };
    }
    if (error.code === "email_address_invalid" || isAuthServiceFailure(error)) {
      return {
        error: authErrorMessage(error, "Nie udało się wysłać kodu. Spróbuj ponownie za chwilę."),
      };
    }
    // Anything else — above all "no account with this address" (otp_disabled)
    // — gets the same answer as a sent code; otherwise this form could be used
    // to enumerate accounts (same reasoning as requestPasswordReset below).
    console.error(`[auth] login code: ${error.code ?? "no-code"} ${error.message}`);
  }

  return { error: null, success: true };
}

export async function verifyLoginCode(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const redirectTo = safeRedirectPath(String(formData.get("redirectTo") ?? ""));

  if (!email || !code) {
    return { error: "Podaj email i kod." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });

  if (error) {
    if (isAuthRateLimit(error) || isAuthServiceFailure(error)) {
      return {
        error: authErrorMessage(error, "Nie udało się sprawdzić kodu. Spróbuj ponownie za chwilę."),
      };
    }
    return { error: "Nieprawidłowy lub wygasły kod. Spróbuj ponownie." };
  }

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!email) {
    return { error: "Podaj adres e-mail." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "forgot_password"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const origin = await requestOrigin();

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/nowe-haslo`,
  });

  if (error) {
    // Refusals that say nothing about the account (see requestLoginCode for
    // the rate limit) are shown, so nobody waits for a link that never went
    // out.
    if (isAuthRateLimit(error)) {
      return {
        error:
          "Link można wysłać najwyżej raz na minutę. Jeśli wiadomość już dotarła, użyj linku z niej — albo odczekaj chwilę i spróbuj jeszcze raz.",
      };
    }
    if (error.code === "email_address_invalid" || isAuthServiceFailure(error)) {
      return {
        error: authErrorMessage(error, "Nie udało się wysłać linku. Spróbuj ponownie za chwilę."),
      };
    }
    console.error(`[auth] password reset: ${error.code ?? "no-code"} ${error.message}`);
  }

  // Otherwise always report success regardless of whether the e-mail has an
  // account — otherwise this form could be used to enumerate accounts.
  return { error: null, success: true };
}

export async function updatePasswordAfterReset(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) {
    return { error: "Hasło musi mieć co najmniej 8 znaków." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Link wygasł. Poproś o nowy link resetujący hasło." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error: authErrorMessage(
        error,
        "Nie udało się ustawić hasła. Spróbuj ponownie albo poproś o nowy link."
      ),
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
