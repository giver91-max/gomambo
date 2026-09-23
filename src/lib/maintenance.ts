import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the public catalogue is hidden right now. Read with whatever
 * client the caller has — site_settings is world-readable by design, and
 * this must work for anonymous visitors and crawlers too.
 *
 * Anything that serves listing data to the open internet has to consult
 * this: the page body is not the only surface. <head> metadata, link
 * previews and the sitemap all leak the fleet just as effectively.
 */
export async function isMaintenanceMode(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("maintenance_mode")
    .eq("id", 1)
    .single();
  return data?.maintenance_mode === true;
}
