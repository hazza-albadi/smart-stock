/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  reactStrictMode: true,
  // the dev-mode "N" badge sat on top of the guided-demo panel (bottom-left in Arabic); build errors still show their overlay
  devIndicators: false,
};
export default nextConfig;
