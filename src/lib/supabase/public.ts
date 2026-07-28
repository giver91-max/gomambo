import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Anon-key client with no cookie/session wiring, safe to call from inside
// unstable_cache (the cookie-based server client can't be — cookies() is
// request-scoped and unstable_cache runs outside that scope). Still subject
// to RLS, so only use it for data that's public to anonymous visitors.
export function createPublicClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
