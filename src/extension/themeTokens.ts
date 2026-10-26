import * as vscode from "vscode";
import { parse as parseJsonc } from "jsonc-parser";
import type { ThemeTokenColors } from "../shared/themeTokens";
import { resolveThemeTokens, rulesOf, type TokenColorRule } from "./themeColors";

/** Settings whose change can alter the resolved token colors. */
const WATCHED_SETTINGS = [
  "workbench.colorTheme",
  "workbench.preferredDarkColorTheme",
  "workbench.preferredLightColorTheme",
  "workbench.preferredHighContrastColorTheme",
  "workbench.preferredHighContrastLightColorTheme",
  "window.autoDetectColorScheme",
  "editor.tokenColorCustomizations",
];
/** Guards against include cycles. */
const MAX_INCLUDE_DEPTH = 10;

/**
 * Token colors of the active color theme, read from the theme file that contributes it plus the user's
 * editor.tokenColorCustomizations. Any failure yields {} so the webview keeps its fallback palette.
 */
export class ThemeTokens implements vscode.Disposable {
  private cached: Promise<ThemeTokenColors> | undefined;
  private readonly changed = new vscode.EventEmitter<ThemeTokenColors>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.disposables = [
      this.changed,
      vscode.window.onDidChangeActiveColorTheme(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (WATCHED_SETTINGS.some((s) => e.affectsConfiguration(s))) this.invalidate();
      }),
      vscode.extensions.onDidChange(() => this.invalidate()),
    ];
  }

  current(): Promise<ThemeTokenColors> {
    this.cached ??= loadThemeTokens().catch(() => ({}));
    return this.cached;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private invalidate(): void {
    this.cached = undefined;
    void this.current().then((colors) => this.changed.fire(colors));
  }
}

/** The configured theme name, honouring window.autoDetectColorScheme like the workbench does. */
function activeThemeName(): string | undefined {
  const config = vscode.workspace.getConfiguration();
  if (config.get<boolean>("window.autoDetectColorScheme")) {
    const key = {
      [vscode.ColorThemeKind.Light]: "workbench.preferredLightColorTheme",
      [vscode.ColorThemeKind.Dark]: "workbench.preferredDarkColorTheme",
      [vscode.ColorThemeKind.HighContrast]: "workbench.preferredHighContrastColorTheme",
      [vscode.ColorThemeKind.HighContrastLight]: "workbench.preferredHighContrastLightColorTheme",
    }[vscode.window.activeColorTheme.kind];
    const name = key ? config.get<string>(key) : undefined;
    if (name) return name;
  }
  return config.get<string>("workbench.colorTheme");
}

/** The theme file contributed under `name` (matched by id or label), across every installed extension. */
function findThemeFile(name: string): vscode.Uri | undefined {
  for (const ext of vscode.extensions.all) {
    const themes = (ext.packageJSON as { contributes?: { themes?: unknown } }).contributes?.themes;
    if (!Array.isArray(themes)) continue;
    for (const t of themes as { id?: unknown; label?: unknown; path?: unknown }[]) {
      if ((t.id === name || t.label === name) && typeof t.path === "string") return vscode.Uri.joinPath(ext.extensionUri, t.path);
    }
  }
  return undefined;
}

async function readJsonc(uri: vscode.Uri): Promise<unknown> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return parseJsonc(new TextDecoder().decode(bytes), [], { allowTrailingComma: true });
}

function sibling(file: vscode.Uri, rel: string): vscode.Uri {
  return vscode.Uri.joinPath(file, "..", rel);
}

/** Rule lists of a theme file and everything it includes, the root of the include chain first. */
async function loadChain(file: vscode.Uri, depth = 0): Promise<TokenColorRule[][]> {
  if (depth > MAX_INCLUDE_DEPTH) return [];
  const json = await readJsonc(file);
  if (typeof json !== "object" || json === null) return [];
  const { include, tokenColors } = json as { include?: unknown; tokenColors?: unknown };
  const chain = typeof include === "string" ? await loadChain(sibling(file, include), depth + 1) : [];
  if (typeof tokenColors === "string") {
    // A plist .tmTheme is not read; its colors fall back to the built-in palette.
    if (/\.json$/i.test(tokenColors)) chain.push(rulesOf(await readJsonc(sibling(file, tokenColors))));
  } else {
    chain.push(rulesOf(json));
  }
  return chain;
}

async function loadThemeTokens(): Promise<ThemeTokenColors> {
  const name = activeThemeName();
  const customizations = vscode.workspace.getConfiguration("editor").get("tokenColorCustomizations");
  const file = name ? findThemeFile(name) : undefined;
  if (!name || !file) return {};
  return resolveThemeTokens(await loadChain(file), customizations, name);
}
