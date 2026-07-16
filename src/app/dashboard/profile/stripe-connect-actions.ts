"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureConnectAccount, createAccountOnboardingLink } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";

export async function createStripeConnectOnboardingLink(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .single();

  const accountResult = await ensureConnectAccount(
    profile?.stripe_connect_account_id ?? null,
    user.email ?? ""
  );
  if (!accountResult.ok) {
    return { error: accountResult.error };
  }

  if (!profile?.stripe_connect_account_id) {
    await supabase
      .from("profiles")
      .update({ stripe_connect_account_id: accountResult.data.accountId })
      .eq("id", user.id);
  }

  const linkResult = await createAccountOnboardingLink(
    accountResult.data.accountId,
    `${SITE_URL}/dashboard/profile`,
    `${SITE_URL}/dashboard/profile`
  );
  if (!linkResult.ok) {
    return { error: linkResult.error };
  }

  redirect(linkResult.data.url);
}
