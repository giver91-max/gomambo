const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHostname = supabaseUrl ? new URL(supabaseUrl).hostname : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Owners can upload up to 8 photos at 5MB each; the framework
      // default (1MB) rejected real camera photos with a 413.
      bodySizeLimit: "50mb",
    },
  },
  images: {
    // Car photos are uploaded at full camera resolution (multi-MB) — let
    // Next.js resize/re-encode them instead of serving the raw originals.
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
