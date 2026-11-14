import { Inter } from "next/font/google";
import { LandingPage } from "@/components/landing-page";

// Declared HERE, in a server component, not inside the "use client" landing
// page. There, the prerendered HTML and the browser bundle got two different
// generated family names (__Inter_882cb4 in the HTML, __Inter_821506 in the
// stylesheet), so the inline font-family named a face that did not exist —
// and with no generic fallback after it, every visitor got the browser's
// default serif font. The `variable` class is rendered once, on the server, and sets
// --font-inter, which the page's CSS puts first in its --font stack.
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "900"],
  variable: "--font-inter",
});

// Deliberately does no request-time work — no session, no cookies, no
// database. That keeps "/" static, so Vercel serves it from the CDN instead
// of booting a function for it; see components/landing-page.tsx.
export default function Home() {
  return (
    <div className={inter.variable}>
      <LandingPage />
    </div>
  );
}
