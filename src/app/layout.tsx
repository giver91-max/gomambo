import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { AnalyticsConsent } from "@/components/analytics-consent";
import { CONSENT_COOKIE, type Consent } from "@/lib/consent";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/site";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "GoMambo — wypożyczalnia i wynajem aut P2P w Polsce",
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "wypożyczalnia samochodów",
    "wypożyczalnia aut",
    "wynajem samochodów",
    "car sharing",
    "wypożyczalnia aut peer-to-peer",
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
    title: "GoMambo — wypożyczalnia i wynajem aut P2P w Polsce",
    description: SITE_DESCRIPTION,
    images: [{ url: "/hero.png", width: 1672, height: 941, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GoMambo — wypożyczalnia i wynajem aut P2P w Polsce",
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const stored = cookieStore.get(CONSENT_COOKIE)?.value;
  const initialConsent: Consent = stored === "accepted" || stored === "rejected" ? stored : null;

  return (
    <html lang="pl" className={cn("font-sans", geistSans.variable, geistMono.variable)}>
      <body className="antialiased">
        {children}
        <Toaster />
        <AnalyticsConsent initialConsent={initialConsent} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </body>
    </html>
  );
}
