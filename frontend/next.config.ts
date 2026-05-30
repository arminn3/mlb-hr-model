import type { NextConfig } from "next";

const PROD_DATA_URL = "https://mlb-hr-model.vercel.app";

const nextConfig: NextConfig = {
  async rewrites() {
    // In dev, proxy /data/* to prod so local always shows live data
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/data/:path*",
        destination: `${PROD_DATA_URL}/data/:path*`,
      },
    ];
  },
};

export default nextConfig;
