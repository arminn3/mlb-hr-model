import type { NextConfig } from "next";

const PROD_DATA_URL = "https://mlb-hr-model.vercel.app";

const nextConfig: NextConfig = {
  async rewrites() {
    // In dev, proxy /data/* to prod so local always shows live data.
    // beforeFiles runs before the filesystem so it overrides stale public/ files.
    if (process.env.NODE_ENV !== "development") return { beforeFiles: [], afterFiles: [], fallback: [] };
    return {
      beforeFiles: [
        {
          source: "/data/:path*",
          destination: `${PROD_DATA_URL}/data/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
