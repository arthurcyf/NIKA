import type { NextConfig } from "next";

const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // Make packages that import "zod/v3" work with zod v4
      'zod/v3': require.resolve('zod'),
    };
    return config;
  },
};

export default nextConfig;
