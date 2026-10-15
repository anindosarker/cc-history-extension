import { useState } from "react";
import { Bot } from "lucide-react";
import type { SubagentInfo } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  agents: SubagentInfo[];
  onOpen: (agentId: string) => void;
  /** Drop the "Agents" word at narrow widths. */
  compact: boolean;
}

/** Green when the agent finished, blue while it is still writing. */
export function StatusDot({ status, className }: { status: SubagentInfo["status"]; className?: string }) {
  return (
    <span
      aria-label={status === "done" ? "Done" : "Running"}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status === "done" ? "bg-[var(--vscode-charts-green)]" : "bg-[var(--vscode-charts-blue)]",
        className,
      )}
    />
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
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-1">
        <ul className="max-h-[60vh] overflow-y-auto scroll-thin">
          {agents.map((a) => (
            <li key={a.agentId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => {
                  setOpen(false);
                  onOpen(a.agentId);
                }}
                title={a.description}
              >
                <StatusDot status={a.status} />
                <span className="min-w-0 flex-1 truncate">{a.description}</span>
                <Badge variant="outline" className="agent-name shrink-0 font-normal">
                  {a.name}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
