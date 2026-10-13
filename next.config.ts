import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep portfolio production builds within the shared host worker budget.
  experimental: { cpus: 2 },
};

export default nextConfig;
