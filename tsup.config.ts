import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  minify: false,
  // CLI entrypoint — npm marks bin files executable on install.
  banner: { js: "#!/usr/bin/env node" },
});
