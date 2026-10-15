import { useRef } from "react";
import { Clipboard, Download, Ellipsis, FileDiff, FileJson, Gauge, Hash, MessageSquare, Play } from "lucide-react";
import type { OpenAt } from "@shared/openAt";
import type { SessionMeta, SubagentInfo } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useContainerWidth } from "@/lib/useContainerWidth";
import { cn } from "@/lib/utils";
import { post } from "@/lib/vscode";
import { AgentsButton } from "./AgentsButton";

export type HeaderTab = "messages" | "files";

interface Props {
  meta: SessionMeta;
  turnCount: number;
  openAt: OpenAt;
  onOpenAtChange: (value: OpenAt) => void;
  agents?: SubagentInfo[];
  onOpenAgent?: (agentId: string) => void;
  tab: HeaderTab;
  onTabChange: (tab: HeaderTab) => void;
  filesCount: number;
  /** The search bar, rendered by the messages view into the middle of row 2. */
  search?: React.ReactNode;
  /** False keeps the slot in the layout but hides it (Files tab, agent view). Defaults to the Messages tab being active. */
  searchVisible?: boolean;
  /** Width override for tests; the browser measures the header. */
  width?: number;
}

/** At and above this width the muted "project · date · N messages" line sits inline after the title. */
export const META_WIDTH = 760;
/** Below this width the inline meta disappears entirely. */
export const META_HIDE_WIDTH = 520;
/** Below this width the tabs become icon plus count. */
export const ICON_TABS_WIDTH = 420;

export type MetaLayout = "full" | "short" | "none";

/** How much of the session meta fits inline next to the title at a given header width. */
export function metaLayoutFor(width: number | undefined): MetaLayout {
  if (width === undefined || width >= META_WIDTH) return "full";
  return width >= META_HIDE_WIDTH ? "short" : "none";
}

export function iconTabsFor(width: number | undefined): boolean {
  return width !== undefined && width < ICON_TABS_WIDTH;
}

/** The lines shown in the title tooltip, in order; empty values are left out. */
export function titleTooltipLines(meta: SessionMeta): string[] {
  const duration =
    meta.startedAt && meta.lastActivityAt ? formatDuration(meta.lastActivityAt - meta.startedAt) : undefined;
  return [
    meta.title,
    meta.projectName,
    meta.startedAt ? formatDateTime(meta.startedAt) : undefined,
    duration,
    meta.gitBranch,
    meta.sessionId,
  ].filter((s): s is string => !!s);
}

/** "project · date · N messages", trimmed to what the layout can hold. */
export function inlineMeta(meta: SessionMeta, turnCount: number, layout: MetaLayout): string | undefined {
  const messages = `${turnCount} message${turnCount === 1 ? "" : "s"}`;
  if (layout === "none") return undefined;
  if (layout === "short") return messages;
  return [meta.projectName, meta.startedAt ? formatDateTime(meta.startedAt) : undefined, messages]
    .filter(Boolean)
    .join(" · ");
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
}

/** The "..." menu's plain items, in order; the Open at radio group sits between the two halves. */
export function menuItems(meta: SessionMeta): { before: MenuItem[]; after: MenuItem[] } {
  return {
    before: [
      { label: "Save as .txt", icon: <Download />, onSelect: () => post({ type: "export", mode: "file" }) },
      { label: "Copy transcript", icon: <Clipboard />, onSelect: () => post({ type: "export", mode: "clipboard" }) },
      { label: "Reveal JSONL", icon: <FileJson />, onSelect: () => post({ type: "revealJsonl" }) },
      { label: "Copy session ID", icon: <Hash />, onSelect: () => post({ type: "copyText", text: meta.sessionId }) },
    ],
    after: [{ label: "Show usage", icon: <Gauge />, onSelect: () => post({ type: "openUsage" }) }],
  };
}

export const OPEN_AT_OPTIONS: { value: OpenAt; label: string }[] = [
  { value: "oldest", label: "Oldest" },
  { value: "newest", label: "Newest" },
];

export function Header({
  meta,
  turnCount,
  openAt,
  onOpenAtChange,
  agents = [],
  onOpenAgent,
  tab,
  onTabChange,
  filesCount,
  search,
  searchVisible,
  width,
}: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const measured = useContainerWidth(rootRef);
  const w = width ?? measured;
  const metaLayout = metaLayoutFor(w);
  const iconTabs = iconTabsFor(w);
  const meta2 = inlineMeta(meta, turnCount, metaLayout);
  const items = menuItems(meta);
  return (
    <header ref={rootRef} className="border-b border-border shrink-0 min-w-0" data-meta={metaLayout}>
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 min-w-0">
        <h1
          className="text-[16px] font-semibold leading-tight min-w-0 truncate shrink"
          title={titleTooltipLines(meta).join("\n")}
        >
          {meta.title}
        </h1>
        <AgentsButton agents={agents} onOpen={(id) => onOpenAgent?.(id)} compact />
        {meta2 && (
          <span className="header-meta text-[12px] text-muted-foreground min-w-0 truncate shrink-[2]" title={meta2}>
            {meta2}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => post({ type: "resume" })}
                aria-label="Resume"
              >
                <Play />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Resume this session in a terminal</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More actions" title="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              {items.before.map((a) => (
                <DropdownMenuItem key={a.label} onSelect={a.onSelect}>
                  {a.icon}
                  {a.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Open at</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={openAt} onValueChange={(v) => onOpenAtChange(v as OpenAt)}>
                {OPEN_AT_OPTIONS.map((o) => (
                  <DropdownMenuRadioItem key={o.value} value={o.value}>
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {items.after.map((a) => (
                <DropdownMenuItem key={a.label} onSelect={a.onSelect}>
                  {a.icon}
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 min-w-0">
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as HeaderTab)} className="shrink-0 min-w-0">
          <TabsList className="flex-nowrap border-b-0">
            <TabsTrigger value="messages" className={iconTabs ? "px-2" : undefined} title="Messages">
              {iconTabs ? (
                <>
                  <MessageSquare className="size-3.5" />
                  <span className="tabular-nums">{turnCount}</span>
                </>
              ) : (
                "Messages"
              )}
            </TabsTrigger>
            <TabsTrigger value="files" className={iconTabs ? "px-2" : undefined} title="Files changed">
              {iconTabs ? (
                <>
                  <FileDiff className="size-3.5" />
                  <span className="tabular-nums">{filesCount}</span>
                </>
              ) : (
                `Files changed (${filesCount})`
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div
          className={cn(
            "flex-1 min-w-0 flex items-center py-1",
            !(searchVisible ?? tab === "messages") && "invisible",
          )}
        >
          {search}
        </div>
      </div>
    </header>
  );
}
