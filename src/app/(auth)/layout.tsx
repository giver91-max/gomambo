import type { Metadata } from "next";

/**
 * Login, registration and password pages: forms, not content, so kept out of
 * search results (and out of the sitemap). They used to inherit the root
 * layout's canonical and declare themselves to be the home page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
