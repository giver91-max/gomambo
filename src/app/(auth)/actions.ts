"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { sendNotificationEmail } from "@/lib/email";
import { verifyRecaptcha } from "@/lib/recaptcha";

export type AuthActionState = { error: string | null };

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const next = String(formData.get("next") ?? "/dashboard");
  const recaptchaToken = String(formData.get("recaptchaToken") ?? "") || null;

  if (!email || !password || !fullName) {
    return { error: "Wypełnij wszystkie pola." };
  }
  if (password.length < 8) {
    return { error: "Hasło musi mieć co najmniej 8 znaków." };
  }
  if (!(await verifyRecaptcha(recaptchaToken, "register"))) {
    return { error: "Weryfikacja antyspamowa nie powiodła się. Spróbuj ponownie." };
  }

  const headersList = await headers();
  const host = headersList.get("host");
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const origin = headersList.get("origin") ?? `${proto}://${host}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  await sendNotificationEmail({
    to: "user@gomambo.pl",
    subject: `Nowa rejestracja: ${fullName}`,
    html: `
      <p>Nowy użytkownik zarejestrował się w GoMambo.</p>
      <ul>
        <li><strong>Imię i nazwisko:</strong> ${fullName}</li>
        <li><strong>Email:</strong> ${email}</li>
      </ul>
    `,
  });

  redirect("/register/sprawdz-email");
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/dashboard");
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
    return { error: "Nieprawidłowy email lub hasło." };
  }

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
