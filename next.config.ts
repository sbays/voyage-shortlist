import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Cloud Run container image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite (local dev only) loads its WebAssembly and data files relative to
  // its own module. Bundled, those URLs point inside .next and fs can't read
  // them, so it's loaded from node_modules instead. `pg` is external already.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    serverActions: {
      // The availability upload accepts files up to 1 MB (MAX_IMPORT_BYTES).
      // The default 1 MB body limit counts multipart overhead too, so a file
      // near the cap would be refused before the action could explain why.
      bodySizeLimit: "1100kb",
    },
  },
};

export default nextConfig;
