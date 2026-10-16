import { defineConfig } from "vitest/config";

// Unit tests for pure app logic only (no React Native runtime).
export default defineConfig({ test: { include: ["lib/**/*.test.ts"], environment: "node" } });
