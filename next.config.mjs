/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Vyapar sync pipeline (better-sqlite3, adm-zip, googleapis) is a
  // standalone script run by GitHub Actions - it is never imported by
  // anything under src/app, so nothing here needs to bundle native modules.
};

export default nextConfig;
