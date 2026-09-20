import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Uses the service role key — bypasses RLS. Never import this from
 * client components or route handlers reachable without an admin check.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Same client, but a missing service-role key returns null instead of
 * throwing. For money paths (cancellation, notifications) where the throw
 * would abort an action that has already moved funds in Stripe and leave
 * the caller with no notification and no trace.
 */
export function tryCreateAdminClient(): ReturnType<typeof createAdminClient> | null {
  try {
    return createAdminClient();
  } catch (error) {
    console.error("[admin-client] unavailable:", error);
    return null;
  }
}
