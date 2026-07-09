"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error: string | null; success?: boolean };

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

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: phone || null })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
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

  const { error } = await supabase.auth.updateUser({ email });
  if (error) {
    return { error: error.message };
  }

  return {
    error: null,
    success: true,
  };
}

export async function updateNotificationPrefs(formData: FormData): Promise<void> {
  const { supabase, user } = await requireUser();
  const notifyEmail = formData.get("notify_email") === "on";

  await supabase.from("profiles").update({ notify_email: notifyEmail }).eq("id", user.id);
  revalidatePath("/dashboard/profile");
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
    return { error: error.message };
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
    return { error: error.message };
  }

  revalidatePath("/dashboard/profile");
  return { error: null };
}
