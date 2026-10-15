import { useRef } from "react";
import { Clipboard, Download, Ellipsis, FileJson, GitBranch, MessageSquare, Play } from "lucide-react";
import type { OpenAt } from "@shared/openAt";
import type { SessionMeta } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useContainerWidth } from "@/lib/useContainerWidth";
import { post } from "@/lib/vscode";
import { OpenAtToggle } from "./OpenAtToggle";

interface Props {
  meta: SessionMeta;
  turnCount: number;
  openAt: OpenAt;
  onOpenAtChange: (value: OpenAt) => void;
}

/** Below this width action buttons drop their labels. */
const COMPACT_WIDTH = 720;
/** Below this width the secondary actions fold into a "..." menu. */
const NARROW_WIDTH = 480;

type Layout = "wide" | "compact" | "narrow";

function layoutFor(width: number | undefined): Layout {
  if (width === undefined || width >= COMPACT_WIDTH) return "wide";
  return width >= NARROW_WIDTH ? "compact" : "narrow";
}

interface Action {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
}

const SECONDARY_ACTIONS: Action[] = [
  {
    label: "Save as .txt",
    hint: "Save the transcript as a text file",
    icon: <Download />,
    onClick: () => post({ type: "export", mode: "file" }),
  },
  {
    label: "Copy",
    hint: "Copy the transcript to the clipboard",
    icon: <Clipboard />,
    onClick: () => post({ type: "export", mode: "clipboard" }),
  },
  {
    label: "Reveal JSONL",
    hint: "Reveal the .jsonl log in Finder",
    icon: <FileJson />,
    onClick: () => post({ type: "revealJsonl" }),
  },
];

const RESUME: Action = {
  label: "Resume",
  hint: "Open a terminal and run claude --resume",
  icon: <Play />,
  onClick: () => post({ type: "resume" }),
};

export function Header({ meta, turnCount, openAt, onOpenAtChange }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const layout = layoutFor(useContainerWidth(rootRef));
  const duration =
    meta.startedAt && meta.lastActivityAt ? formatDuration(meta.lastActivityAt - meta.startedAt) : undefined;
  return (
    <header ref={rootRef} className="px-4 pt-3 pb-2 border-b border-border shrink-0 min-w-0" data-layout={layout}>
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-[1.25em] font-semibold leading-tight flex-1 min-w-0 truncate" title={meta.title}>
          {meta.title}
        </h1>
        <div className="flex items-center gap-1.5 shrink-0">
          <OpenAtToggle value={openAt} onChange={onOpenAtChange} />
          <ActionButton action={RESUME} iconOnly={layout !== "wide"} />
          {layout === "narrow" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" aria-label="More actions" title="More actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SECONDARY_ACTIONS.map((a) => (
                  <DropdownMenuItem key={a.label} onSelect={a.onClick}>
                    {a.icon}
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            SECONDARY_ACTIONS.map((a, i) => (
              <ActionButton
                key={a.label}
                action={a}
                iconOnly={layout === "compact"}
                variant={i === SECONDARY_ACTIONS.length - 1 ? "outline" : "secondary"}
              />
            ))
          )}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-medium text-foreground cursor-default truncate max-w-full">{meta.projectName}</span>
          </TooltipTrigger>
          <TooltipContent>{meta.cwd}</TooltipContent>
        </Tooltip>
        {meta.startedAt && <span className="whitespace-nowrap">{formatDateTime(meta.startedAt)}</span>}
        {duration && <span className="whitespace-nowrap">{duration}</span>}
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <MessageSquare className="size-3.5" />
          {turnCount} messages
        </span>
        {meta.gitBranch && (
          <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">{meta.gitBranch}</span>
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="font-mono text-[0.85em] opacity-70 hover:opacity-100 cursor-pointer truncate max-w-full min-w-0"
              onClick={() => post({ type: "copyText", text: meta.sessionId })}
            >
              {meta.sessionId}
            </button>
          </TooltipTrigger>
          <TooltipContent>Click to copy the session id</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function ActionButton({
  action,
  iconOnly,
  variant = "default",
}: {
  action: Action;
  iconOnly: boolean;
  variant?: "default" | "secondary" | "outline";
}) {
  if (!iconOnly) {
    return (
      <Button variant={variant} onClick={action.onClick} title={action.hint}>
        {action.icon}
        {action.label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size="icon" className="h-7 w-7" onClick={action.onClick} aria-label={action.label}>
          {action.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}
