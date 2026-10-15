import { useState } from "react";
import { Bot, ChevronRight, ExternalLink, FileDiff, Loader2 } from "lucide-react";
import type { FileChange } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { basename, dirname } from "@/lib/format";
import { post } from "@/lib/vscode";
import { cn } from "@/lib/utils";

interface Props {
  files: FileChange[];
  /** True while the host is still collecting edits from subagent transcripts. */
  merging?: boolean;
  agentCount?: number;
}

export function FilesTab({ files, merging = false, agentCount = 0 }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const notice = merging && (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/60">
      <Loader2 className="size-3 animate-spin" />
      Collecting edits from {agentCount} agent {agentCount === 1 ? "transcript" : "transcripts"}…
    </div>
  );
  if (files.length === 0) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        {notice}
        <div className="p-6 text-center text-muted-foreground">No files were edited in this session.</div>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      {notice}
      <ul className="py-1">
        {files.map((f) => {
          const expanded = open.has(f.path);
          return (
            <li key={f.path} className="border-b border-border/60 last:border-b-0">
              <div
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer"
                onClick={() => post({ type: "openDiff", path: f.path })}
                title="Open whole-file diff"
              >
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(f.path);
                  }}
                  aria-label={expanded ? "Collapse hunks" : "Expand hunks"}
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
                </button>
                <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{basename(f.path)}</span>
                  {dirname(f.path) && <span className="text-muted-foreground ml-1.5">{dirname(f.path)}</span>}
                </span>
                {f.agents?.map((name) => (
                  <Tooltip key={name}>
                    <TooltipTrigger asChild>
                      <Badge variant="muted" className="gap-1 font-normal max-w-[10rem]">
                        <Bot className="size-3 shrink-0" />
                        <span className="truncate">{name}</span>
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Edited by the {name} subagent</TooltipContent>
                  </Tooltip>
                ))}
                <Badge variant="added">+{f.added}</Badge>
                <Badge variant="removed">-{f.removed}</Badge>
                <Badge variant="muted">
                  {f.hunks.length} {f.hunks.length === 1 ? "hunk" : "hunks"}
                </Badge>
                {f.partial && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline">partial</Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      The whole file could not be reconstructed from the session. The diff shows each hunk instead.
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    post({ type: "revealFile", path: f.path });
                  }}
                  title="Open the current file on disk"
                >
                  <ExternalLink />
                  Reveal file
                </Button>
              </div>
              {expanded && (
                <ol className="pb-1">
                  {f.hunks.map((h, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 pl-12 pr-3 py-1 hover:bg-accent cursor-pointer text-muted-foreground"
                      onClick={() => post({ type: "openDiff", path: f.path, hunkIndex: i })}
                      title="Open this hunk as a diff"
                    >
                      <span className="tabular-nums w-8">#{i + 1}</span>
                      <span className="text-foreground">{h.tool}</span>
                      {h.agent && (
                        <span className="inline-flex items-center gap-1 text-[11px]" title={`Edited by the ${h.agent} subagent`}>
                          <Bot className="size-3" />
                          {h.agent}
                        </span>
                      )}
                      <span className="text-added">+{h.added}</span>
                      <span className="text-removed">-{h.removed}</span>
                      <span className="truncate font-mono text-[0.9em] opacity-80">{firstLine(h.after || h.before)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, 120);
}
