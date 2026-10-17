import type { NextConfig } from "next";

const apiTarget = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

const config: NextConfig = {
  // Workspace packages are TypeScript source.
  transpilePackages: ["@sj/contracts", "@sj/client", "@sj/web-session"],
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${apiTarget.replace(/\/$/, "")}/v1/:path*`,
      },
      {
        source: "/healthz",
        destination: `${apiTarget.replace(/\/$/, "")}/healthz`,
      },
    ];
  },
};
export default config;

