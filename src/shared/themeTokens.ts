/** Syntax token colors the webview takes from the active VS Code theme, each set as the CSS var `--tok-<key>`. */
export const THEME_TOKEN_KEYS = [
  "keyword",
  "string",
  "number",
  "comment",
  "function",
  "type",
  "variable",
  "regexp",
  "literal",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];

/** Resolved foregrounds; a missing key means the webview keeps its built-in fallback color. */
export type ThemeTokenColors = Partial<Record<ThemeTokenKey, string>>;
