import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { isPasswordResetTarget, linkFailurePath } from "../link-failure";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  // A token_hash link (the e-mail templates Supabase can send instead of the
  // PKCE ?code= ones) belongs to /auth/confirm, which verifies it only after
  // a click — a mail scanner opening the link must not use it up.
  const tokenHash = searchParams.get("token_hash");
  if (!code && tokenHash) {
    const confirm = new URL("/auth/confirm", origin);
    confirm.searchParams.set("token_hash", tokenHash);
    confirm.searchParams.set("type", searchParams.get("type") ?? "");
    confirm.searchParams.set("next", next);
    return NextResponse.redirect(confirm);
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error(`[auth/callback] code exchange failed: ${error.code ?? "no-code"} ${error.message}`);
  } else {
    // Supabase sends an expired or already-used link here without a code,
    // with error/error_code in the query or (invisible to the server) in the
    // fragment.
    console.error(
      `[auth/callback] no code: ${searchParams.get("error_code") ?? searchParams.get("error") ?? "no error param"}`
    );
  }

  // Clicked a second time in the browser it already worked in: the session
  // is there, so just carry on. Not for a reset link — whoever happens to be
  // signed in on this device is not necessarily the person who asked for it.
  if (!isPasswordResetTarget(next)) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}${linkFailurePath(next)}`);
}
