import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { AnalyticsConsent } from "@/components/analytics-consent";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/site";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
});
// Not preloaded. It is used in four places — the transfer title in the admin
// and rental screens — yet preloading it put 65 kB on the critical path of
// every first visit to every page, the landing page included. Without the
// preload the browser fetches it only when a page actually renders
// monospace text.
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  weight: "100 900",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "GoMambo — wynajem aut P2P i wypożyczalnie w jednym miejscu",
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "wypożyczalnia samochodów",
    "wypożyczalnia aut",
    "wynajem samochodów",
    "wynajem aut P2P",
    "wypożyczalnie samochodów w jednym miejscu",
    "porównywarka wypożyczalni",
    "wynajmij auto",
    "udostępnij auto",
    "GoMambo",
  ],
  authors: [{ name: SITE_NAME }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pl_PL",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "GoMambo — wynajem aut P2P i wypożyczalnie w jednym miejscu",
    description: SITE_DESCRIPTION,
    images: [{ url: "/hero.png", width: 1672, height: 543, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GoMambo — wynajem aut P2P i wypożyczalnie w jednym miejscu",
    description: SITE_DESCRIPTION,
    images: ["/hero.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "AutoRental",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  description: SITE_DESCRIPTION,
  areaServed: "PL",
};

// No cookies() or headers() here, ever. A request-time read in the ROOT
// layout makes every page in the app dynamic — see analytics-consent.tsx for
// what that cost.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className={cn("font-sans", geistSans.variable, geistMono.variable)}>
      <body className="antialiased">
        {children}
        <Toaster />
        <AnalyticsConsent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </body>
    </html>
  );
}
