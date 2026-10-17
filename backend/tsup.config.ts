import { defineConfig } from "tsup";

// Bundle the API for production. Workspace packages (@sj/*) are TypeScript source, so they are inlined.
export default defineConfig({
  entry: ["src/main.ts", "src/worker.ts", "src/db/migrate.ts", "src/serverless.ts"],
  dts: true,
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@sj\//],
});
