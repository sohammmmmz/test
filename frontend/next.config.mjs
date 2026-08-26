/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next normally 308-redirects "/path/" to "/path" before a route handler
  // runs, which rewrites the URL the API proxy was asked to forward. DRF
  // registers its routes *with* a trailing slash, so Django would then try to
  // APPEND_SLASH-redirect — which it cannot do for a POST without dropping the
  // body. Skipping the redirect lets the proxy forward paths exactly as sent.
  skipTrailingSlashRedirect: true,
  env: {
    BACKEND_INTERNAL_URL: process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000",
  },
};
export default nextConfig;
