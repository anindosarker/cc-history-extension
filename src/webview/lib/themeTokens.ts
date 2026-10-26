import { THEME_TOKEN_KEYS, type ThemeTokenColors } from "@shared/themeTokens";

/** Set `--tok-<key>` for every color the host sent and clear the rest, so styles.css falls back to its palette. */
export function applyThemeTokens(style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">, colors: ThemeTokenColors): void {
  for (const key of THEME_TOKEN_KEYS) {
    const value = colors[key];
    if (value) style.setProperty(`--tok-${key}`, value);
    else style.removeProperty(`--tok-${key}`);
  }
}
