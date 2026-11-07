"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensureConnectAccount, createAccountOnboardingLink, stripeMode } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site";

export async function createStripeConnectOnboardingLink(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id, role")
    .eq("id", user.id)
    .single();

  // The button is hidden in this case too; this is the server's half of it.
  if (stripeMode() !== "live" && profile?.role !== "admin") {
    return {
      error: "Wypłaty uruchomimy razem z wynajmem — wtedy damy znać. Teraz nic nie musisz robić.",
    };
  }

  const accountResult = await ensureConnectAccount(
    profile?.stripe_connect_account_id ?? null,
    user.email ?? ""
  );
  if (!accountResult.ok) {
    return { error: accountResult.error };
  }

  if (accountResult.data.created) {
    // Service role: which Connect account an owner is paid into is pinned
    // against session writes in the database (migration 0036), so a user
    // can't point someone else's payouts — or their own — at another
    // account by PATCHing their profile row. A replaced account (see
    // ensureConnectAccount) has not been onboarded, whatever the old flag said.
    await createAdminClient()
      .from("profiles")
      .update({
        stripe_connect_account_id: accountResult.data.accountId,
        stripe_connect_onboarded: false,
      })
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
