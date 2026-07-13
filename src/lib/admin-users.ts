import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// auth.admin.listUsers() paginates (50/page by default) — loop until
// exhausted so admin/users doesn't silently drop anyone past page 1.
export async function getAuthEmailsByUserId(): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const emailsById = new Map<string, string>();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const u of data.users) {
      if (u.email) emailsById.set(u.id, u.email);
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  return emailsById;
}
