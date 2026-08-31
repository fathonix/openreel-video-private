import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "dev-server": "src/dev-server.ts",
  },
  format: ["cjs", "esm"],
  platform: "node",
  target: "node18",
  // Workspace source packages are consumed as TS and must be inlined into the
  // standalone bundles (only Node built-ins stay external).
  noExternal: ["@openreel/agent", "@openreel/core"],
  clean: true,
  sourcemap: true,
});