import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith("/dashboard");
  const isAdmin = path.startsWith("/admin");
  // Every gate below hands on the full path AND query. The query is what
  // carries a deep link through login and the forms in between — e.g.
  // VERIFICATION_PATH's krok=weryfikacja, which makes the profile page scroll
  // to the verification card; a #fragment never reaches the server, so it
  // cannot. (Next strips its internal _rsc param before middleware runs.)
  const target = `${path}${request.nextUrl.search}`;

  // Public pages resolve their own auth state per-request via createClient()
  // where they need it, so there's no reason to pay a Supabase Auth round
  // trip here on every single page view — only gated routes need it.
  if (!isDashboard && !isAdmin) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithTarget(request, "/login", target);
  }

  if (isAdmin || isDashboard) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, phone, terms_version")
      .eq("id", user.id)
      .single();

    if (isAdmin && profile?.role !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    // Required for account verification (name + phone) — enforced right
    // after login since the email-code sign-in path skips the registration
    // form that used to collect full_name, and phone was never collected
    // there at all.
    if (isDashboard && (!profile?.full_name || !profile?.phone)) {
      return redirectWithTarget(request, "/uzupelnij-dane", target);
    }

    // Accounts from before the terms checkbox never accepted anything, and a
    // rewritten Regulamin has to be accepted again — both by bumping or
    // missing CURRENT_TERMS_VERSION. Everyone in the dashboard has agreed to
    // the text that is actually in force.
    //
    // Not for server-action POSTs: the browser would follow the redirect with
    // the action still attached, Next would forward it back here, and the
    // action would silently not run. The next page load asks instead.
    if (
      isDashboard &&
      profile?.terms_version !== CURRENT_TERMS_VERSION &&
      !(request.method === "POST" && request.headers.has("next-action"))
    ) {
      return redirectWithTarget(request, "/akceptacja-regulaminu", target);
    }
  }

  return response;
}

/**
 * Redirect to a gate page with only ?redirect=<target>. The page's query is
 * cleared first: a clone keeps the original params, so /dashboard/profile?krok=x
 * used to become /login?krok=x&redirect=%2Fdashboard%2Fprofile — the query
 * stranded on the login page instead of travelling inside redirect.
 */
function redirectWithTarget(request: NextRequest, pathname: string, target: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  url.searchParams.set("redirect", target);
  return NextResponse.redirect(url);
}
