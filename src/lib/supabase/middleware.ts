import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

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
      .select("role, full_name, phone")
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
  }

  return response;
}
