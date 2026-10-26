import Module, { createRequire } from "node:module";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  // The UMD build hides its internal requires from esbuild; the ESM build bundles whole.
  alias: { "jsonc-parser": "jsonc-parser/lib/esm/main.js" },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
  // The vsix ships without node_modules, so any require the bundle could not inline fails at activation.
  // Loading it here, with a stand-in for vscode, turns that into a build error.
  const stub = new Proxy(function () {}, { get: (_t, key) => (key === "__esModule" ? false : stub) });
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode" ? stub : load.call(this, request, ...rest);
  };
  try {
    createRequire(import.meta.url)("./dist/extension.js");
  } catch (err) {
    console.error(`dist/extension.js does not load on its own: ${err.message}`);
    process.exit(1);
  } finally {
    Module._load = load;
  }
}
