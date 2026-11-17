import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Opens a private file for the admin: an identity document or selfie, a car's
 * OC policy, a rental company's registration document.
 *
 * The pages used to put a signed Storage URL straight into the HTML. Those
 * expired five or ten minutes after the page loaded, so a PDF clicked later —
 * or a photo lazy-loaded further down — opened a Supabase "token expired"
 * error. And every token is different, so each re-render after an approval
 * changed every <img src> and the browser downloaded all the documents again
 * (several MB each, straight off the Supabase egress quota).
 *
 * This URL never changes for a given file. It signs a fresh link at the moment
 * it is opened and redirects to it, and lets the browser keep that redirect for
 * a while, so the same image is not fetched twice. Callers pass the ROW id,
 * never a storage path: the path is looked up here, so a crafted URL cannot
 * reach an arbitrary object in the bucket. Links are built by ./url.ts.
 */

const SIGNED_URL_SECONDS = 60 * 60;
// Shorter than the signed link's lifetime, so a redirect the browser kept
// never points at a link that has already expired.
const REDIRECT_CACHE_SECONDS = 50 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

async function locate(
  admin: ReturnType<typeof createAdminClient>,
  kind: string,
  id: string
): Promise<{ bucket: string; path: string } | null> {
  if (kind === "dokument" || kind === "dokument-tyl" || kind === "selfie") {
    const { data } = await admin
      .from("identity_verifications")
      .select("document_path, document_back_path, selfie_path")
      .eq("id", id)
      .maybeSingle();
    const path =
      kind === "dokument"
        ? data?.document_path
        : kind === "dokument-tyl"
          ? data?.document_back_path
          : data?.selfie_path;
    return path ? { bucket: "id-documents", path } : null;
  }
  if (kind === "polisa") {
    const { data } = await admin
      .from("car_private")
      .select("insurance_document_path")
      .eq("car_id", id)
      .maybeSingle();
    return data?.insurance_document_path
      ? { bucket: "car-insurance", path: data.insurance_document_path }
      : null;
  }
  if (kind === "firma") {
    const { data } = await admin
      .from("partner_documents")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    return data?.storage_path ? { bucket: "partner-documents", path: data.storage_path } : null;
  }
  return null;
}

function plain(text: string, status: number): NextResponse {
  return new NextResponse(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("plik") ?? "";
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return plain("Nie ma takiego pliku.", 404);

  // Middleware already keeps non-admins out of /admin/*, but this hands out
  // identity documents, so it checks for itself before touching the service
  // role.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return plain("Zaloguj się ponownie.", 401);
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return plain("Brak uprawnień.", 403);

  const admin = createAdminClient();
  const file = await locate(admin, kind, id);
  if (!file) return plain("Nie ma takiego pliku — mógł zostać usunięty.", 404);

  const { data: signed } = await admin.storage
    .from(file.bucket)
    .createSignedUrl(file.path, SIGNED_URL_SECONDS);
  if (!signed?.signedUrl) return plain("Nie udało się otworzyć pliku. Spróbuj ponownie.", 502);

  const response = NextResponse.redirect(signed.signedUrl, 302);
  // private: only this browser keeps it. Vary: Cookie, so a different login
  // on the same computer does not get the previous admin's redirect.
  response.headers.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}`);
  response.headers.set("Vary", "Cookie");
  return response;
}

