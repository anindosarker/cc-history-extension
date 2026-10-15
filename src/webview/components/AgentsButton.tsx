import { useState } from "react";
import { Bot, Check, X } from "lucide-react";
import { agentLabel } from "@shared/agents";
import type { SubagentInfo, SubagentStatus } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  agents: SubagentInfo[];
  onOpen: (agentId: string) => void;
  /** Drop the "Agents" word at narrow widths. */
  compact: boolean;
}

export const STATUS_TEXT: Record<SubagentStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  unknown: "Unknown",
};

/** "Agents (N) · k done · m running", with failed agents counted when there are any. */
export function agentsSummary(agents: readonly Pick<SubagentInfo, "status">[]): string {
  const n = (s: SubagentStatus) => agents.filter((a) => a.status === s).length;
  const parts = [`Agents (${agents.length})`, `${n("done")} done`, `${n("running")} running`];
  const failed = n("failed");
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** Blue pulsing dot while running, green check when done, red x when failed, grey dot when unknown. */
export function StatusIcon({ status, className }: { status: SubagentStatus; className?: string }) {
  const label = STATUS_TEXT[status];
  if (status === "done") {
    return <Check aria-label={label} className={cn("agent-status size-3 shrink-0 text-[var(--vscode-charts-green)]", className)} data-status={status} />;
  }
  if (status === "failed") {
    return <X aria-label={label} className={cn("agent-status size-3 shrink-0 text-[var(--vscode-charts-red)]", className)} data-status={status} />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      data-status={status}
      className={cn(
        "agent-status inline-block size-2 shrink-0 rounded-full",
        status === "running" ? "agent-pulse bg-[var(--vscode-charts-blue)]" : "bg-muted-foreground/50",
        className,
      )}
    />
  );
}

/** "name  description" like Claude Code's own agent list; the description alone when the agent has no name. */
export function AgentRowLabel({ agent, className }: { agent: SubagentInfo; className?: string }) {
  const label = agentLabel(agent);
  return (
    <span className={cn("min-w-0 flex-1 flex items-baseline gap-1.5", className)} title={label.tooltip}>
      <span className={cn("truncate", label.secondary !== undefined ? "agent-name shrink-0 max-w-[55%] font-medium" : "min-w-0")}>
        {label.primary}
      </span>
      {label.secondary !== undefined && <span className="min-w-0 truncate text-muted-foreground">{label.secondary}</span>}
    </span>
  );
}

/** "Agents (N)" ghost button that opens a list of the session's subagent transcripts. */
export function AgentsButton({ agents, onOpen, compact }: Props) {
  const [open, setOpen] = useState(false);
  if (agents.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className={cn("text-muted-foreground", compact && "px-2")} title="Subagent transcripts">
          <Bot />
          {compact ? agents.length : `Agents (${agents.length})`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-1">
        <div className="agents-summary px-2 py-1 text-[11px] text-muted-foreground select-none">{agentsSummary(agents)}</div>
        <ul className="max-h-[60vh] overflow-y-auto scroll-thin">
          {agents.map((a) => (
            <li key={a.agentId}>
              <button
                type="button"
                className="agent-row flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => {
                  setOpen(false);
                  onOpen(a.agentId);
                }}
              >
                <StatusIcon status={a.status} />
                <AgentRowLabel agent={a} />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
