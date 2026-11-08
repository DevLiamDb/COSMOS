import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Coupe le badge "N" (Dev Tools indicator) affiché en bas à gauche par
  // Next.js en développement — purement cosmétique, aucun effet en prod.
  devIndicators: false,
};

export default nextConfig;
