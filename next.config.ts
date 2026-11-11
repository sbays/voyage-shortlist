import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Cloud Run container image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
