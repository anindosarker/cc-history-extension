import { THEME_TOKEN_KEYS, type ThemeTokenColors, type ThemeTokenKey } from "../shared/themeTokens";

/** One entry of a theme's tokenColors (or a tmTheme's settings) array. */
export interface TokenColorRule {
  scope?: string | string[];
  settings?: { foreground?: string };
}

/** Scopes probed per token, in order; the first probe any rule matches decides the color. */
const PROBES: Record<ThemeTokenKey, string[]> = {
  // storage.type first: highlight.js tags const and return alike, and the terminal shows them blue.
  keyword: ["storage.type", "keyword.control", "keyword"],
  string: ["string.quoted.double"],
  number: ["constant.numeric"],
  comment: ["comment.line"],
  function: ["entity.name.function"],
  type: ["entity.name.type", "support.type", "support.class"],
  variable: ["variable.other.readwrite", "variable", "variable.other.property"],
  regexp: ["string.regexp"],
  literal: ["constant.language"],
};

/** The scopes VS Code assigns to the shorthand keys of editor.tokenColorCustomizations. */
const CUSTOMIZATION_SCOPES: Record<string, string[]> = {
  comments: ["comment", "punctuation.definition.comment"],
  strings: ["string", "meta.embedded.assembly"],
  keywords: ["keyword", "keyword.control", "storage", "storage.type"],
  numbers: ["constant.numeric"],
  types: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
  functions: ["entity.name.function", "support.function"],
  variables: ["variable", "entity.name.variable"],
};

const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** One scope name, no spaces: descendant ("source.js string") and exclusion ("a - b") selectors never match. */
const SIMPLE_SELECTOR = /^[\w.+#-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The token rules a parsed theme file holds itself: `tokenColors` (when inline) or a tmTheme-style `settings` array. */
export function rulesOf(json: unknown): TokenColorRule[] {
  if (Array.isArray(json)) return json.filter(isObject) as TokenColorRule[];
  if (!isObject(json)) return [];
  if (Array.isArray(json.tokenColors)) return json.tokenColors.filter(isObject) as TokenColorRule[];
  if (Array.isArray(json.settings)) return json.settings.filter(isObject) as TokenColorRule[];
  return [];
}

/** Simple selectors of a rule: comma lists split, descendant, exclusion and grouped selectors dropped. */
function selectorsOf(scope: TokenColorRule["scope"]): string[] {
  const parts = (Array.isArray(scope) ? scope : [scope]).filter((s): s is string => typeof s === "string");
  return parts
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => SIMPLE_SELECTOR.test(s));
}

/** Whether `selector` names `probe` or one of its parent scopes ("string" matches "string.quoted.double"). */
export function scopeMatches(selector: string, probe: string): boolean {
  return probe === selector || probe.startsWith(`${selector}.`);
}

/**
 * The foreground for one scope: the matching selector with the most segments wins, ties go to the later rule,
 * as in TextMate. Rules must be ordered lowest priority first.
 */
export function foregroundFor(rules: TokenColorRule[], probe: string): string | undefined {
  let best: string | undefined;
  let bestDepth = 0;
  for (const rule of rules) {
    const fg = rule.settings?.foreground;
    if (typeof fg !== "string" || !COLOR.test(fg)) continue;
    for (const sel of selectorsOf(rule.scope)) {
      if (!scopeMatches(sel, probe)) continue;
      const depth = sel.split(".").length;
      if (depth >= bestDepth) {
        best = fg;
        bestDepth = depth;
      }
    }
  }
  return best;
}

/** Rules from one level of editor.tokenColorCustomizations (shorthand keys first, then textMateRules). */
function customizationRules(level: Record<string, unknown>): TokenColorRule[] {
  const rules: TokenColorRule[] = [];
  for (const [key, scopes] of Object.entries(CUSTOMIZATION_SCOPES)) {
    const v = level[key];
    const fg = typeof v === "string" ? v : isObject(v) && typeof v.foreground === "string" ? v.foreground : undefined;
    if (fg) rules.push({ scope: scopes, settings: { foreground: fg } });
  }
  if (Array.isArray(level.textMateRules)) rules.push(...(level.textMateRules.filter(isObject) as TokenColorRule[]));
  return rules;
}

/**
 * Token colors for the webview. `chain` holds each theme file's own rules, the root of the include chain first;
 * `customizations` is the raw editor.tokenColorCustomizations value, whose `[Theme Name]` block applies last.
 */
export function resolveThemeTokens(chain: TokenColorRule[][], customizations: unknown, themeName: string): ThemeTokenColors {
  const rules = chain.flat();
  if (isObject(customizations)) {
    rules.push(...customizationRules(customizations));
    const scoped = customizations[`[${themeName}]`];
    if (isObject(scoped)) rules.push(...customizationRules(scoped));
  }
  const out: ThemeTokenColors = {};
  for (const key of THEME_TOKEN_KEYS) {
    for (const probe of PROBES[key]) {
      const fg = foregroundFor(rules, probe);
      if (fg) {
        out[key] = fg;
        break;
      }
    }
  }
  return out;
}
