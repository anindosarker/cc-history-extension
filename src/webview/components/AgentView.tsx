import { ArrowLeft, Bot, ChevronLeft, ChevronRight, Clipboard, Download, Loader2, X } from "lucide-react";
import type { OpenAt } from "@shared/openAt";
import type { SubagentInfo, Turn } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatDuration, formatTokens } from "@/lib/format";
import { post } from "@/lib/vscode";
import { StatusDot } from "./AgentsButton";
import { MessagesView } from "./MessagesView";

export type AgentLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; turns: Turn[]; total: number; done: boolean; tokens: number };

interface Props {
  agent: SubagentInfo;
  /** Position of this agent in the list, 0-based, and the list length. */
  position: number;
  count: number;
  load: AgentLoad | undefined;
  active: boolean;
  openAt: OpenAt;
  jumpKey: number;
  onBack: () => void;
  onStep: (delta: number) => void;
}

/** A subagent transcript in place of the main messages area, with its own search and filters. */
export function AgentView({ agent, position, count, load, active, openAt, jumpKey, onBack, onStep }: Props) {
  const duration =
    agent.startedAt && agent.endedAt && agent.endedAt > agent.startedAt
      ? formatDuration(agent.endedAt - agent.startedAt)
      : undefined;
  const tokens = load?.status === "loaded" ? load.tokens : undefined;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-1.5 pb-1 border-b border-border shrink-0 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconButton label="Back to the session transcript" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
          <Bot className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium" title={agent.description}>
            {agent.description}
          </span>
          <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground max-w-[12rem] truncate">
            {agent.name}
          </Badge>
          <span className="shrink-0 tabular-nums text-muted-foreground text-[11px] whitespace-nowrap ml-1">
            {position + 1} of {count}
          </span>
          <IconButton label="Previous agent" onClick={() => onStep(-1)} disabled={position <= 0}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next agent" onClick={() => onStep(1)} disabled={position >= count - 1}>
            <ChevronRight />
          </IconButton>
          <IconButton
            label="Save agent transcript as .txt"
            onClick={() => post({ type: "export", mode: "file", agentId: agent.agentId })}
          >
            <Download />
          </IconButton>
          <IconButton
            label="Copy agent transcript"
            onClick={() => post({ type: "export", mode: "clipboard", agentId: agent.agentId })}
          >
            <Clipboard />
          </IconButton>
          <IconButton label="Close agent view (Esc)" onClick={onBack}>
            <X />
          </IconButton>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground select-none">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status={agent.status} />
            {agent.status === "done" ? "Done" : "Running"}
          </span>
          {duration && <span>{duration}</span>}
          {tokens !== undefined && <span title={`${tokens.toLocaleString()} tokens`}>{formatTokens(tokens)} tokens</span>}
          {agent.startedAt && <span>{formatDateTime(agent.startedAt)}</span>}
          {agent.model && <span>{agent.model}</span>}
        </div>
      </div>
      {load === undefined || load.status === "loading" ? (
        <Center>
          <Loader2 className="size-5 animate-spin" />
          <span className="text-muted-foreground">Loading agent transcript…</span>
        </Center>
      ) : load.status === "error" ? (
        <Center>
          <span className="text-destructive">Could not load this agent transcript.</span>
          <pre className="mono-pre text-muted-foreground max-w-[80ch]">{load.message}</pre>
        </Center>
      ) : load.turns.length === 0 && load.done ? (
        <Center>
          <span className="text-muted-foreground">This agent has no displayable messages.</span>
        </Center>
      ) : (
        <MessagesView turns={load.turns} loadingMore={!load.done} active={active} openAt={openAt} jumpKey={jumpKey} />
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={onClick} disabled={disabled} aria-label={label} className="shrink-0">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 p-6">{children}</div>;
}
