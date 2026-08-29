/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Vyapar sync pipeline (better-sqlite3, adm-zip, googleapis) is a
  // standalone script run by GitHub Actions - it is never imported by
  // anything under src/app, so nothing here needs to bundle native modules.

  async headers() {
    return [
      {
        // A cached service worker is a stuck service worker: the browser
        // would keep running an old copy, including its old caching rules,
        // long after a deploy. Revalidating every time is the fix, and the
        // file is tiny.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
