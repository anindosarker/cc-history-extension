import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Check, ChevronRight, X } from "lucide-react";
import { agentLabel } from "@shared/agents";
import type { SubagentInfo, SubagentStatus, WorkflowRun } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { formatDuration, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  /** Direct subagents; workflow agents come inside `workflows`. */
  agents: SubagentInfo[];
  workflows: WorkflowRun[];
  onOpen: (agentId: string) => void;
  /** Drop the "Agents" word at narrow widths. */
  compact: boolean;
  /** A change reopens the menu at the level it was left on. */
  reopen?: number;
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

/** Where the menu is: the sections, the direct agents list, or one workflow run's agents. */
export type AgentsLevel = { kind: "root" } | { kind: "direct" } | { kind: "run"; runId: string };

const ROOT: AgentsLevel = { kind: "root" };

/** The run's status as an agent status, for the shared status icon. */
export function runIconStatus(status: string): SubagentStatus {
  if (status === "completed") return "done";
  if (status === "running") return "running";
  if (status === "failed" || status === "killed" || status === "error") return "failed";
  return "unknown";
}

/** "completed · 54m · 3 agents": the run row in the sections list. */
export function runRowDetail(run: WorkflowRun): string {
  const parts = [run.status];
  if (run.durationMs !== undefined) parts.push(formatDuration(run.durationMs));
  parts.push(`${run.agents.length} ${run.agents.length === 1 ? "agent" : "agents"}`);
  return parts.join(" · ");
}

/** "completed · 54m · 466k tokens · 103 tool calls": the line under the run name. */
export function runSummaryLine(run: WorkflowRun): string {
  const parts = [run.status];
  if (run.durationMs !== undefined) parts.push(formatDuration(run.durationMs));
  if (run.totalTokens !== undefined) parts.push(`${formatTokens(run.totalTokens)} tokens`);
  if (run.totalToolCalls !== undefined) parts.push(`${run.totalToolCalls} tool calls`);
  return parts.join(" · ");
}

/** The run's agents under its phase titles in phase order; agents without a known phase last. */
export function phaseGroups(run: WorkflowRun): { title?: string; agents: SubagentInfo[] }[] {
  const groups: { title?: string; agents: SubagentInfo[] }[] = [];
  for (const title of run.phases) {
    const agents = run.agents.filter((a) => a.phase === title);
    if (agents.length > 0) groups.push({ title, agents });
  }
  const rest = run.agents.filter((a) => a.phase === undefined || !run.phases.includes(a.phase));
  if (rest.length > 0) groups.push({ title: groups.length > 0 ? "Other" : undefined, agents: rest });
  return groups;
}

/** Direct agents plus every run's agents. */
export function agentTotal(agents: readonly SubagentInfo[], workflows: readonly WorkflowRun[]): number {
  return workflows.reduce((n, r) => n + r.agents.length, agents.length);
}

interface MenuProps {
  agents: SubagentInfo[];
  workflows: WorkflowRun[];
  level: AgentsLevel;
  onLevel: (level: AgentsLevel) => void;
  onOpen: (agentId: string) => void;
}

/**
 * The popover body. With workflow runs it starts at the sections (Workflows, Direct agents) and
 * drills into one run or the direct list; without any it is the direct list alone.
 */
export function AgentsMenu({ agents, workflows, level, onLevel, onOpen }: MenuProps) {
  if (workflows.length === 0) return <AgentList agents={agents} summary={agentsSummary(agents)} onOpen={onOpen} />;
  const run = level.kind === "run" ? workflows.find((r) => r.runId === level.runId) : undefined;
  if (run) {
    return (
      <>
        <BackRow onBack={() => onLevel(ROOT)} />
        <div className="workflow-head px-2 pb-1 select-none">
          <div className="truncate font-medium" title={run.summary ?? run.name}>
            {run.name}
          </div>
          <div className="workflow-summary text-[11px] text-muted-foreground">{runSummaryLine(run)}</div>
        </div>
        <Separator />
        <ul className="max-h-[60vh] overflow-y-auto scroll-thin">
          {phaseGroups(run).map((g, i) => (
            <li key={g.title ?? `rest-${i}`}>
              {g.title !== undefined && <SectionLabel className="workflow-phase">{g.title}</SectionLabel>}
              <ul>
                {g.agents.map((a) => (
                  <AgentRow key={a.agentId} agent={a} onOpen={onOpen} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (level.kind === "direct" && agents.length > 0) {
    return (
      <>
        <BackRow onBack={() => onLevel(ROOT)} />
        <AgentList agents={agents} summary={agentsSummary(agents)} onOpen={onOpen} />
      </>
    );
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto scroll-thin">
      <SectionLabel>Workflows</SectionLabel>
      <ul>
        {workflows.map((r) => (
          <li key={r.runId}>
            <Button
              variant="ghost"
              className="workflow-row h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left font-normal"
              title={r.summary}
              onClick={() => onLevel({ kind: "run", runId: r.runId })}
            >
              <StatusIcon status={runIconStatus(r.status)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{runRowDetail(r)}</span>
              </span>
              <ChevronRight className="text-muted-foreground" />
            </Button>
          </li>
        ))}
      </ul>
      {agents.length > 0 && (
        <>
          <Separator className="my-1" />
          <SectionLabel>Direct agents</SectionLabel>
          <Button
            variant="ghost"
            className="direct-row h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left font-normal"
            onClick={() => onLevel({ kind: "direct" })}
          >
            <Bot className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{agentsSummary(agents)}</span>
            <ChevronRight className="text-muted-foreground" />
          </Button>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-2 pt-1.5 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none", className)}>
      {children}
    </div>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="agents-back text-muted-foreground" onClick={onBack}>
      <ArrowLeft />
      Back
    </Button>
  );
}

function AgentList({ agents, summary, onOpen }: { agents: SubagentInfo[]; summary: string; onOpen: (agentId: string) => void }) {
  return (
    <>
      <div className="agents-summary px-2 py-1 text-[11px] text-muted-foreground select-none">{summary}</div>
      <ul className="max-h-[60vh] overflow-y-auto scroll-thin">
        {agents.map((a) => (
          <AgentRow key={a.agentId} agent={a} onOpen={onOpen} />
        ))}
      </ul>
    </>
  );
}

function AgentRow({ agent, onOpen }: { agent: SubagentInfo; onOpen: (agentId: string) => void }) {
  return (
    <li>
      <Button
        variant="ghost"
        className="agent-row h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-left font-normal [&_svg]:size-3"
        onClick={() => onOpen(agent.agentId)}
      >
        <StatusIcon status={agent.status} />
        <AgentRowLabel agent={agent} />
      </Button>
    </li>
  );
}

/**
 * "Agents (N)" ghost button over every agent of the session, direct and workflow. The menu keeps
 * its level while an agent is open, so `reopen` (bumped by the agent view's back control) shows
 * the list the agent came from; dismissing the menu returns it to the top.
 */
export function AgentsButton({ agents, workflows, onOpen, compact, reopen }: Props) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<AgentsLevel>(ROOT);
  const seen = useRef(reopen);
  useEffect(() => {
    if (reopen === seen.current) return;
    seen.current = reopen;
    setOpen(true);
  }, [reopen]);
  const total = agentTotal(agents, workflows);
  if (total === 0 && workflows.length === 0) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setLevel(ROOT);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" className={cn("text-muted-foreground", compact && "px-2")} title="Subagent and workflow agent transcripts">
          <Bot />
          {compact ? total : `Agents (${total})`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-1">
        <AgentsMenu
          agents={agents}
          workflows={workflows}
          level={level}
          onLevel={setLevel}
          onOpen={(agentId) => {
            setOpen(false);
            onOpen(agentId);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
