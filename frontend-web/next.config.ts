import type { NextConfig } from "next";

const apiTarget = process.env.API_PROXY_TARGET;

const config: NextConfig = {
  // Workspace packages are TypeScript source.
  transpilePackages: ["@sj/contracts", "@sj/client", "@sj/web-session"],
  poweredByHeader: false,
  async rewrites() {
    if (apiTarget && apiTarget.trim()) {
      return [
        {
          source: "/v1/:path*",
          destination: `${apiTarget.trim().replace(/\/$/, "")}/v1/:path*`,
        },
        {
          source: "/healthz",
          destination: `${apiTarget.trim().replace(/\/$/, "")}/healthz`,
        },
      ];
    }
    return [];
  },
};
export default config;

