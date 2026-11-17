"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage } from "@/app/(auth)/auth-errors";

export type ProfileState = { error: string | null; success?: boolean };

// Supabase Auth answers in English ("For security purposes, you can only
// request this after 37 seconds."); authErrorMessage (shared with the login
// and registration actions) maps the stable error code to Polish and logs the
// original. Database errors are developer English too ("new row violates
// row-level security policy…") — logged, never shown.
const SAVE_FAILED_MESSAGE = "Nie udało się zapisać zmiany. Spróbuj ponownie za chwilę.";

function dbErrorMessage(error: { code?: string; message: string }, context: string): string {
  console.error(`[profile] ${context}`, { code: error.code, message: error.message });
  return SAVE_FAILED_MESSAGE;
}

/** The address a confirmation link is built on — the same rule as the login actions. */
async function requestOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("host");
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  return headersList.get("origin") ?? `${proto}://${host}`;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

export async function updateProfile(
  _prevState: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const { supabase, user } = await requireUser();

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName) {
    return { error: "Podaj imię i nazwisko." };
  }
  // Not SMS-verified yet (no SMS gateway) — just a plausible-length check
  // until phone confirmation exists.
  if (phone.replace(/\D/g, "").length < 9) {
    return { error: "Podaj poprawny numer telefonu." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone })
    .eq("id", user.id);

  if (error) {
    return { error: dbErrorMessage(error, "updateProfile") };
  }

  revalidatePath("/dashboard/profile");
  return { error: null, success: true };
}

export async function updateEmail(
  _prevState: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const { supabase } = await requireUser();
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Podaj adres e-mail." };
  }

  // Without emailRedirectTo the confirmation link lands on the bare Site
  // URL, where nothing exchanges its PKCE code, so the change never
  // completed. /auth/callback exchanges it and brings the person back here.
  const origin = await requestOrigin();
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/dashboard/profile")}` }
  );
  if (error) {
    // The shared text for this code tells a signed-out visitor to log in —
    // wrong advice for someone changing the address of the account they are in.
    if (error.code === "email_exists") {
      console.error(`[profile] updateEmail: email_exists`);
      return { error: "Ten adres e-mail jest już używany przez inne konto." };
    }
    return { error: authErrorMessage(error, SAVE_FAILED_MESSAGE) };
  }

  return {
    error: null,
    success: true,
  };
}

// Requires the current password (verified via a real sign-in attempt, not
// just "logged in") before allowing a change — the only self-service way to
// change a password today was the logged-out /nowe-haslo reset-link flow,
// unreachable from any UI while already logged in.
export async function updatePassword(
  _prevState: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const { supabase, user } = await requireUser();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "Wypełnij wszystkie pola." };
  }
  // Same minimum as registration and the reset-link flow.
  if (newPassword.length < 8) {
    return { error: "Nowe hasło musi mieć co najmniej 8 znaków." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Nowe hasła nie są identyczne." };
  }
  if (!user.email) {
    return { error: "Brak adresu e-mail na koncie." };
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    // A rate limit is not a wrong password — saying so would send the
    // person hunting for a password that was right all along.
    if (verifyError.code === "over_request_rate_limit" || verifyError.status === 429) {
      return { error: authErrorMessage(verifyError, SAVE_FAILED_MESSAGE) };
    }
    return { error: "Obecne hasło jest nieprawidłowe." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { error: authErrorMessage(error, SAVE_FAILED_MESSAGE) };
  }

  return { error: null, success: true };
}

export async function updateNotificationPrefs(
  formData: FormData
): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();
  const notifyEmail = formData.get("notify_email") === "on";
  const notifySms = formData.get("notify_sms") === "on";

  if (notifySms) {
    const { data: profile } = await supabase.from("profiles").select("phone").eq("id", user.id).single();
    if (!profile?.phone) {
      return { error: "Podaj numer telefonu powyżej, zanim włączysz powiadomienia SMS." };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ notify_email: notifyEmail, notify_sms: notifySms })
    .eq("id", user.id);

  if (error) {
    return { error: dbErrorMessage(error, "updateNotificationPrefs") };
  }

  revalidatePath("/dashboard/profile");
  return { error: null };
}

export async function setAvatar(path: string): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .single();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", user.id);

  if (error) {
    return { error: dbErrorMessage(error, "setAvatar") };
  }

  if (profile?.avatar_path) {
    await supabase.storage.from("avatars").remove([profile.avatar_path]);
  }

  revalidatePath("/dashboard/profile");
  return { error: null };
}

export async function removeAvatar(): Promise<{ error: string | null }> {
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .single();

  if (!profile?.avatar_path) {
    return { error: null };
  }

  await supabase.storage.from("avatars").remove([profile.avatar_path]);

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", user.id);

  if (error) {
    return { error: dbErrorMessage(error, "removeAvatar") };
  }

  revalidatePath("/dashboard/profile");
  return { error: null };
}
