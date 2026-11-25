import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The intelligence route reads its payload with fs at revalidation time, which the
  // tracer cannot see — ship the pre-built snapshot with the function.
  outputFileTracingIncludes: {
    "/api/intelligence/data": ["./src/data/intelligence-payload.production.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
