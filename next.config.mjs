/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Owners can upload up to 8 photos at 5MB each; the framework
      // default (1MB) rejected real camera photos with a 413.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
