import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith("/dashboard");
  const isAdmin = path.startsWith("/admin");

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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
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
      const url = request.nextUrl.clone();
      url.pathname = "/uzupelnij-dane";
      url.searchParams.set("redirect", path);
      return NextResponse.redirect(url);
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
      const url = request.nextUrl.clone();
      url.pathname = "/akceptacja-regulaminu";
      url.search = "";
      url.searchParams.set("redirect", `${path}${request.nextUrl.search}`);
      return NextResponse.redirect(url);
    }
  }

  return response;
}
