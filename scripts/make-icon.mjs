// Renders media/icon.png (128x128) and media/icon@2x.png (256x256) from media/session-claude.svg:
// the coral asterisk on a dark rounded square.
//
// Needs @resvg/resvg-js, which is not a project dependency. Either add it with
// `pnpm add -D @resvg/resvg-js` or point RESVG_DIR at a folder whose node_modules has it:
//   RESVG_DIR=/some/dir node scripts/make-icon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const media = join(root, "media");

const BASE = 128; // logical size; the @2x variant renders the same drawing at scale 2
const RADIUS = 24;
const PADDING = 20;
const BACKGROUND = "#1f1f1f";

function loadResvg() {
  const candidates = [import.meta.url];
  if (process.env.RESVG_DIR) candidates.unshift(join(resolve(process.env.RESVG_DIR), "package.json"));
  for (const from of candidates) {
    try {
      return createRequire(from)("@resvg/resvg-js");
    } catch {
      /* try the next location */
    }
  }
  throw new Error("@resvg/resvg-js not found: run `pnpm add -D @resvg/resvg-js` or set RESVG_DIR");
}

/** The drawable content of the source icon (everything inside the root <svg>) and its viewBox size. */
function sourceGlyph() {
  const svg = readFileSync(join(media, "session-claude.svg"), "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number) ?? [0, 0, 16, 16];
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
  if (!inner) throw new Error("media/session-claude.svg has no <svg> body");
  return { inner, size: Math.max(viewBox[2], viewBox[3]) };
}

function wrapperSvg() {
  const { inner, size } = sourceGlyph();
  const scale = (BASE - 2 * PADDING) / size;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE}" height="${BASE}" viewBox="0 0 ${BASE} ${BASE}">`,
    `  <rect width="${BASE}" height="${BASE}" rx="${RADIUS}" ry="${RADIUS}" fill="${BACKGROUND}"/>`,
    `  <g transform="translate(${PADDING} ${PADDING}) scale(${scale})">${inner}</g>`,
    `</svg>`,
    "",
  ].join("\n");
}

function render(Resvg, svg, pixels) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: pixels }, background: "rgba(0,0,0,0)" });
  return r.render().asPng();
}

const { Resvg } = loadResvg();
const svg = wrapperSvg();
writeFileSync(join(media, "icon.png"), render(Resvg, svg, BASE));
writeFileSync(join(media, "icon@2x.png"), render(Resvg, svg, BASE * 2));
console.log("wrote media/icon.png (128x128) and media/icon@2x.png (256x256)");
