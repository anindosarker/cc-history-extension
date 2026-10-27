import { useEffect, useRef, useState } from "react";
import {
  Clipboard,
  Download,
  Ellipsis,
  ExternalLink,
  FileDiff,
  FileJson,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Hash,
  MessageSquare,
  Play,
  RefreshCw,
} from "lucide-react";
import type { OpenAt } from "@shared/openAt";
import type { SessionMeta, SubagentInfo, WorkflowRun } from "@shared/types";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
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
import { formatDuration, formatFullDateTime, formatHumanDateTime } from "@/lib/format";
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
  /** Direct subagents; workflow agents come inside `workflows`. */
  agents?: SubagentInfo[];
  workflows?: WorkflowRun[];
  onOpenAgent?: (agentId: string) => void;
  /** Bumped to reopen the agents menu where it was left. */
  agentsMenuReopen?: number;
  tab: HeaderTab;
  onTabChange: (tab: HeaderTab) => void;
  filesCount: number;
  /** The search bar, rendered by the messages view into the middle of row 2. */
  search?: React.ReactNode;
  /** False keeps the slot in the layout but hides it (Files tab, agent view). Defaults to the Messages tab being active. */
  searchVisible?: boolean;
  /** Width override for tests; the browser measures the header. */
  width?: number;
  /** Test override: render the title tooltip open (it is otherwise hover driven and lives outside server output). */
  titleTooltipOpen?: boolean;
  /** A live Claude process owns the session and is writing to it. */
  live?: boolean;
  /** Re-read the transcript from disk. */
  onReload?: () => void;
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
    meta.startedAt ? formatFullDateTime(meta.startedAt) : undefined,
    duration,
    meta.gitBranch,
    meta.sessionId,
  ].filter((s): s is string => !!s);
}

/** "date · N messages" after the folder button, trimmed to what the layout can hold. */
export function inlineMeta(meta: SessionMeta, turnCount: number, layout: MetaLayout, now?: number): string | undefined {
  const messages = `${turnCount} message${turnCount === 1 ? "" : "s"}`;
  if (layout === "none") return undefined;
  if (layout === "short") return messages;
  return [meta.startedAt ? formatHumanDateTime(meta.startedAt, { now }) : undefined, messages].filter(Boolean).join(" · ");
}

export interface FolderAction {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

/** Right-click menu of the folder button. */
export function folderActions(meta: SessionMeta): FolderAction[] {
  return [
    { label: "Open in Finder", icon: <FolderOpen />, onSelect: () => post({ type: "openFolder" }) },
    { label: "Copy path", icon: <Clipboard />, onSelect: () => post({ type: "copyText", text: meta.cwd }) },
    {
      label: "Open in new VS Code window",
      icon: <ExternalLink />,
      onSelect: () => post({ type: "folderAction", action: "newWindow" }),
    },
    {
      label: "Add to workspace",
      icon: <FolderPlus />,
      onSelect: () => post({ type: "folderAction", action: "addToWorkspace" }),
    },
  ];
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
  workflows = [],
  onOpenAgent,
  agentsMenuReopen,
  tab,
  onTabChange,
  filesCount,
  search,
  searchVisible,
  width,
  titleTooltipOpen,
  live = false,
  onReload,
}: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const measured = useContainerWidth(rootRef);
  const w = width ?? measured;
  const metaLayout = metaLayoutFor(w);
  const iconTabs = iconTabsFor(w);
  const meta2 = inlineMeta(meta, turnCount, metaLayout);
  const items = menuItems(meta);
  const tooltipLines = titleTooltipLines(meta);
  const actions = folderActions(meta);

  // The title tooltip only matters while the title is cut off; a click shows the whole thing in place.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [truncated, setTruncated] = useState<boolean | undefined>(undefined);
  const [wrapped, setWrapped] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setTruncated(!wrapped && el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapped, meta.title]);
  useEffect(() => {
    if (!wrapped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setWrapped(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wrapped]);
  const tooltipOpen = titleTooltipOpen ? true : wrapped || truncated === false ? false : undefined;

  return (
    <header ref={rootRef} className="border-b border-border shrink-0 min-w-0" data-meta={metaLayout}>
      <div className={cn("flex gap-2 px-3 pt-2 pb-1 min-w-0", wrapped ? "items-start" : "items-center")}>
        <Tooltip delayDuration={150} open={tooltipOpen}>
          <TooltipTrigger asChild>
            <h1
              ref={titleRef}
              className={cn(
                "text-[16px] font-semibold leading-tight min-w-0 shrink",
                wrapped ? "whitespace-normal break-words" : "truncate",
                (truncated || wrapped) && "cursor-pointer",
              )}
              // Native fallback until the browser has measured the title; the tooltip takes over after.
              title={truncated === undefined ? tooltipLines.join("\n") : undefined}
              data-wrapped={wrapped || undefined}
              onClick={() => {
                if (wrapped || truncated) setWrapped((v) => !v);
              }}
            >
              {meta.title}
            </h1>
          </TooltipTrigger>
          <TooltipContent portal={false} side="bottom" align="start" className="title-tooltip max-w-[480px] py-1.5">
            <div className="font-medium break-words">{meta.title}</div>
            {tooltipLines.slice(1).map((line, i) => (
              <div key={i} className="text-muted-foreground text-[12px] break-words">
                {line}
              </div>
            ))}
          </TooltipContent>
        </Tooltip>
        <AgentsButton agents={agents} workflows={workflows} onOpen={(id) => onOpenAgent?.(id)} compact reopen={agentsMenuReopen} />
        <ContextMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="folder-button shrink-0 px-1.5 text-muted-foreground font-normal max-w-[14rem]"
                  onClick={() => post({ type: "openFolder" })}
                  aria-label={`Open folder ${meta.cwd}`}
                  data-path={meta.cwd}
                >
                  <Folder />
                  {metaLayout !== "none" && <span className="min-w-0 truncate">{meta.projectName}</span>}
                </Button>
              </ContextMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{meta.cwd}</TooltipContent>
          </Tooltip>
          <ContextMenuContent>
            {actions.map((a, i) => (
              <ContextMenuGroupItem key={a.label} action={a} separatorBefore={i === 2} />
            ))}
          </ContextMenuContent>
        </ContextMenu>
        {meta2 && (
          <span className="header-meta text-[12px] text-muted-foreground min-w-0 truncate shrink-[2]" title={meta2}>
            {meta2}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {live && (
            <span
              className="live-indicator mr-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground select-none"
              title="A Claude Code process is writing to this session"
            >
              <span className="agent-pulse inline-block size-2 rounded-full bg-[var(--vscode-charts-blue)]" aria-hidden="true" />
              Live
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onReload?.()}
                aria-label="Reload transcript"
              >
                <RefreshCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload transcript</TooltipContent>
          </Tooltip>
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

function ContextMenuGroupItem({ action, separatorBefore }: { action: FolderAction; separatorBefore: boolean }) {
  return (
    <>
      {separatorBefore && <ContextMenuSeparator />}
      <ContextMenuItem onSelect={action.onSelect}>
        {action.icon}
        {action.label}
      </ContextMenuItem>
    </>
  );
}
