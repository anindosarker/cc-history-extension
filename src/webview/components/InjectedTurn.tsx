import { memo, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import type { VisibleTurn } from "@/lib/search";
import { formatClock, formatFullDateTime } from "@/lib/format";
import { TimeStamp } from "./TurnRow";
import { cn } from "@/lib/utils";
import { Highlight } from "./Highlight";
import { Markdown } from "./Markdown";

const PREVIEW_CHARS = 100;

interface Props {
  item: VisibleTurn;
  query: string;
  /** Occurrence index of the current match inside the body, or -1. */
  current: number;
  /** "HH:MM" or empty. */
  time: string;
}

function bodyOf(item: VisibleTurn): string {
  return item.blocks
    .map((b) => (b.type === "text" ? b.text : b.type === "thinking" ? b.thinking : b.type === "image" ? "[image]" : b.summary))
    .join("\n");
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_CHARS ? oneLine.slice(0, PREVIEW_CHARS - 1).trimEnd() + "…" : oneLine;
}

/** A message another Claude session or teammate sent: faint meta line and a collapsed card. */
export const AgentTurn = memo(function AgentTurn({ item, query, current, time }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (current >= 0) setOpen(true);
  }, [current]);
  const body = bodyOf(item);
  const line = item.turn.summary || preview(body);
  const name = item.turn.agentName ?? "agent";
  return (
    <div className="chat-turn py-[10px]" data-turn-index={item.index}>
      <div className="chat-content">
        <Collapsible open={open} onOpenChange={setOpen} className="agent-card tier-2 min-w-0">
          <div
            className="mb-1.5 text-[11px] leading-none select-none"
            title={item.turn.timestamp ? formatFullDateTime(item.turn.timestamp) : undefined}
          >
            {"Agent · "}
            <Badge variant="outline" className="agent-name px-1 py-0 text-[10px] leading-4 font-normal align-middle">
              {name}
            </Badge>
            {time ? ` · ${time}` : ""}
          </div>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="tool-pill tier-hover flex w-full max-w-full items-center gap-1.5 rounded-[6px] border px-2 py-[5px] text-left leading-snug cursor-pointer select-none"
              title={line}
            >
              <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
              <span className="min-w-0 truncate">{line}</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="tool-pre mt-2 rounded-[6px] border px-3 py-2 text-[13px] leading-[1.55]">
              <Markdown text={body} query={query} current={current} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
});

/** Tool-injected user text (system reminders, task notifications, command echoes): a one-liner that unfolds. */
export const SystemTurn = memo(function SystemTurn({ item, query, current, time }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (current >= 0) setOpen(true);
  }, [current]);
  const body = bodyOf(item);
  const label = item.turn.label ?? "system";
  return (
    <div className="chat-turn py-[6px]" data-turn-index={item.index}>
      <div className="chat-content">
        <Collapsible open={open} onOpenChange={setOpen} className="tier-2 min-w-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="system-line tier-hover flex max-w-full items-center gap-1.5 leading-snug cursor-pointer select-none"
              title={item.turn.timestamp ? `System · ${label} · ${formatFullDateTime(item.turn.timestamp)}` : `System · ${label}`}
            >
              <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
              <span className="min-w-0 truncate">{["System", label, time].filter(Boolean).join(" · ")}</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="tool-pre mono-pre mt-2 max-h-[60vh] overflow-auto scroll-thin rounded-[6px] border p-2">
              <Highlight text={body} query={query} current={current} />
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
});

/** An away_summary record: a small card with a left rule, the content the person came back to read. */
export const RecapTurn = memo(function RecapTurn({ item, query, current }: Omit<Props, "time">) {
  const body = bodyOf(item);
  const ts = item.turn.timestamp;
  return (
    <div className="chat-turn py-[12px]" data-turn-index={item.index}>
      <div className="chat-content">
        <div className="recap-card border-l-2 pl-3 py-0.5">
          <div className="flex items-center gap-3 select-none">
            <span className="recap-label text-[11px] tracking-wide text-muted-foreground">RECAP</span>
            <Separator className="fold-rule flex-1 w-auto" />
            {ts ? (
              <span className="text-[11px] text-muted-foreground tier-3">
                <TimeStamp time={formatClock(ts)} fullTime={formatFullDateTime(ts)} />
              </span>
            ) : null}
          </div>
          <div className="recap-body mt-1 text-[13px] leading-[1.55] text-foreground">
            <Markdown text={body} query={query} current={current} />
          </div>
        </div>
      </div>
    </div>
  );
});

/** A compact_boundary or informational record: a centered one-line divider, like the date row. */
export const NoticeTurn = memo(function NoticeTurn({ item, query, current }: Omit<Props, "time">) {
  const body = bodyOf(item);
  const ts = item.turn.timestamp;
  const usage = item.turn.subtype === "informational" && /usage limit/i.test(body);
  return (
    <div className="chat-turn notice-row py-[2px]" data-turn-index={item.index}>
      <div
        className="chat-content tier-2 flex items-center gap-3 leading-none select-none"
        title={ts ? formatFullDateTime(ts) : undefined}
      >
        <Separator className="fold-rule flex-1 w-auto" />
        <span className={cn("tier-3 min-w-0 max-w-[80%] truncate text-center text-[11px]", usage && "notice-usage")}>
          <Highlight text={body} query={query} current={current} />
        </span>
        <Separator className="fold-rule flex-1 w-auto" />
      </div>
    </div>
  );
});
