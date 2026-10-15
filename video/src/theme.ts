export const BG = "#1f1f1f";
export const ACCENT = "#D97757";
export const TEXT = "#ffffff";
export const MUTED = "#a8a8a8";
export const BORDER = "rgba(255,255,255,0.14)";

export const FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const MONO =
  '"SF Mono", Menlo, "JetBrains Mono", Consolas, "Liberation Mono", monospace';

/** Natural pixel sizes of the screenshots in public/, so frames never stretch. */
export const SHOTS = {
  tree: { file: "tree.png", w: 760, h: 1666 },
  viewer: { file: "viewer.png", w: 2004, h: 1662 },
  search: { file: "search.png", w: 2004, h: 1662 },
  agents: { file: "agents.png", w: 2004, h: 800 },
  agentView: { file: "agent-view.png", w: 2004, h: 1662 },
  files: { file: "files.png", w: 2004, h: 1662 },
  diff: { file: "diff.png", w: 2004, h: 1662 },
  usage: { file: "usage.png", w: 2004, h: 940 },
  statusbar: { file: "statusbar.png", w: 640, h: 56 },
  light: { file: "light.png", w: 2004, h: 1662 },
} as const;

export type Shot = (typeof SHOTS)[keyof typeof SHOTS];
