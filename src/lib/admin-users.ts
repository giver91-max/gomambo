import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthAccount = {
  email: string;
  // False until the person clicks the link in the sign-up mail. Supabase
  // refuses a password login before that, so the admin has to be able to
  // see it when someone says they cannot log in.
  emailConfirmed: boolean;
};

// auth.admin.listUsers() paginates (50/page by default) — loop until
// exhausted so admin/users doesn't silently drop anyone past page 1.
export async function getAuthAccountsByUserId(): Promise<Map<string, AuthAccount>> {
  const admin = createAdminClient();
  const accountsById = new Map<string, AuthAccount>();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const u of data.users) {
      if (u.email) accountsById.set(u.id, { email: u.email, emailConfirmed: !!u.email_confirmed_at });
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  return accountsById;
}

export async function getAuthEmailsByUserId(): Promise<Map<string, string>> {
  const accounts = await getAuthAccountsByUserId();
  return new Map(Array.from(accounts, ([id, account]) => [id, account.email]));
}
