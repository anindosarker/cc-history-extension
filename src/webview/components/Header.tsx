import { Clipboard, Download, FileJson, GitBranch, MessageSquare, Play } from "lucide-react";
import type { OpenAt } from "@shared/openAt";
import type { SessionMeta } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatDuration } from "@/lib/format";
import { post } from "@/lib/vscode";
import { OpenAtToggle } from "./OpenAtToggle";

interface Props {
  meta: SessionMeta;
  turnCount: number;
  openAt: OpenAt;
  onOpenAtChange: (value: OpenAt) => void;
}

export function Header({ meta, turnCount, openAt, onOpenAtChange }: Props) {
  const duration =
    meta.startedAt && meta.lastActivityAt ? formatDuration(meta.lastActivityAt - meta.startedAt) : undefined;
  return (
    <header className="px-4 pt-3 pb-2 border-b border-border">
      <div className="flex items-start gap-3">
        <h1 className="text-[1.25em] font-semibold leading-tight flex-1 min-w-0 break-words">{meta.title}</h1>
        <div className="flex items-center gap-1.5 shrink-0">
          <OpenAtToggle value={openAt} onChange={onOpenAtChange} />
          <Button onClick={() => post({ type: "resume" })} title="Open a terminal and run claude --resume">
            <Play />
            Resume
          </Button>
          <Button variant="secondary" onClick={() => post({ type: "export", mode: "file" })}>
            <Download />
            Save as .txt
          </Button>
          <Button variant="secondary" onClick={() => post({ type: "export", mode: "clipboard" })}>
            <Clipboard />
            Copy
          </Button>
          <Button variant="outline" onClick={() => post({ type: "revealJsonl" })} title="Reveal the .jsonl log in Finder">
            <FileJson />
            Reveal JSONL
          </Button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-medium text-foreground cursor-default">{meta.projectName}</span>
          </TooltipTrigger>
          <TooltipContent>{meta.cwd}</TooltipContent>
        </Tooltip>
        {meta.startedAt && <span>{formatDateTime(meta.startedAt)}</span>}
        {duration && <span>{duration}</span>}
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" />
          {turnCount} messages
        </span>
        {meta.gitBranch && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3.5" />
            {meta.gitBranch}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="font-mono text-[0.85em] opacity-70 hover:opacity-100 cursor-pointer"
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
