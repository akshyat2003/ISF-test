import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are TypeScript source.
  transpilePackages: ["@sj/contracts", "@sj/client", "@sj/web-session"],
  poweredByHeader: false,
};
export default config;
