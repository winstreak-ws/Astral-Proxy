// esbuild.config.js
const { build } = require("esbuild");

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "dist/bundle.cjs",
  minify: true,
  sourcemap: false,
  external: [
    "fs",
    "path",
    "crypto",
    "events",
    "process",

    "minecraft-protocol",
    "minecraft-data",
    "prismarine-*",
    "buffer-equal",

  ],
}).catch(() => process.exit(1));
