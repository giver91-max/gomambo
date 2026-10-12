import { LandingPage } from "@/components/landing-page";

// Deliberately does no request-time work — no session, no cookies, no
// database. That keeps "/" static, so Vercel serves it from the CDN instead
// of booting a function for it; see components/landing-page.tsx.
export default function Home() {
  return <LandingPage />;
}
