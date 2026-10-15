import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_OPEN_AT, type OpenAt } from "@shared/openAt";
import type { HostToWebview } from "@shared/protocol";
import type { FileChange, SessionMeta, SubagentInfo, Turn } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentsContext } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { post } from "@/lib/vscode";
import { AgentView, type AgentLoad } from "./components/AgentView";
import { FilesTab } from "./components/FilesTab";
import { Header } from "./components/Header";
import { MessagesView } from "./components/MessagesView";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; meta: SessionMeta; files: FileChange[]; turns: Turn[]; total: number; done: boolean };

/** Whether the Files tab still shows main-only changes, is collecting subagent edits, or has them. */
type FilesScope = "main" | "merging" | "merged";

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tab, setTab] = useState<"messages" | "files">("messages");
  const [openAt, setOpenAt] = useState<OpenAt>(DEFAULT_OPEN_AT);
  // Bumped on each user toggle so the list jumps right away, before the host acks.
  const [jumpKey, setJumpKey] = useState(0);
  const [agents, setAgents] = useState<SubagentInfo[]>([]);
  const [agentView, setAgentView] = useState<string | undefined>(undefined);
  const [agentLoads, setAgentLoads] = useState<Record<string, AgentLoad>>({});
  const [filesScope, setFilesScope] = useState<FilesScope>("main");

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostToWebview>) => {
      const msg = e.data;
      switch (msg.type) {
        case "loading":
          setState({ status: "loading" });
          break;
        case "error":
          setState({ status: "error", message: msg.message });
          break;
        case "openAt":
          setOpenAt(msg.value);
          break;
        case "sessionStart":
          setOpenAt(msg.openAt);
          setAgents([]);
          setAgentView(undefined);
          setAgentLoads({});
          setFilesScope("main");
          setState({
            status: "loaded",
            meta: msg.meta,
            files: msg.files,
            turns: [],
            total: msg.totalTurns,
            done: msg.totalTurns === 0,
          });
          post({ type: "listAgents" });
          break;
        case "sessionTurns":
          setState((s) => {
            if (s.status !== "loaded") return s;
            const turns = s.turns.slice();
            for (let i = 0; i < msg.turns.length; i++) turns[msg.offset + i] = msg.turns[i];
            return { ...s, turns, done: msg.done };
          });
          break;
        case "agents":
          setAgents(msg.list);
          break;
        case "agentStart":
          setAgentLoads((m) => ({
            ...m,
            [msg.agentId]: {
              status: "loaded",
              turns: [],
              total: msg.totalTurns,
              done: msg.totalTurns === 0,
              tokens: msg.tokens,
            },
          }));
          break;
        case "agentTurns":
          setAgentLoads((m) => {
            const cur = m[msg.agentId];
            if (!cur || cur.status !== "loaded") return m;
            const turns = cur.turns.slice();
            for (let i = 0; i < msg.turns.length; i++) turns[msg.offset + i] = msg.turns[i];
            return { ...m, [msg.agentId]: { ...cur, turns, done: msg.done } };
          });
          break;
        case "agentError":
          setAgentLoads((m) => ({ ...m, [msg.agentId]: { status: "error", message: msg.message } }));
          break;
        case "files":
          setFilesScope("merged");
          setState((s) => (s.status === "loaded" ? { ...s, files: msg.files } : s));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const changeOpenAt = useCallback((value: OpenAt) => {
    setOpenAt(value);
    setJumpKey((k) => k + 1);
    post({ type: "setOpenAt", value });
  }, []);

  const openAgent = useCallback((agentId: string) => {
    setTab("messages");
    setAgentView(agentId);
    setAgentLoads((m) => {
      if (m[agentId] && m[agentId].status !== "error") return m;
      post({ type: "loadAgent", agentId });
      return { ...m, [agentId]: { status: "loading" } };
    });
  }, []);

  const closeAgent = useCallback(() => setAgentView(undefined), []);

  // Esc leaves the agent view unless something closer to the key (search box, menus) already used it.
  useEffect(() => {
    if (!agentView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeAgent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentView, closeAgent]);

  // The Files tab pulls in subagent edits the first time it opens, when there are agents to read.
  useEffect(() => {
    if (tab !== "files" || filesScope !== "main" || agents.length === 0) return;
    setFilesScope("merging");
    post({ type: "loadFiles" });
  }, [tab, filesScope, agents.length]);

  const agentsValue = useMemo(() => ({ agents, openAgent }), [agents, openAgent]);

  if (state.status === "loading") {
    return (
      <Center>
        <Loader2 className="size-5 animate-spin" />
        <span>Loading session…</span>
      </Center>
    );
  }
  if (state.status === "error") {
    return (
      <Center>
        <span className="text-destructive">Could not load this session.</span>
        <pre className="mono-pre text-muted-foreground max-w-[80ch]">{state.message}</pre>
        <Button variant="secondary" onClick={() => post({ type: "loadSession" })}>
          Retry
        </Button>
      </Center>
    );
  }

  const { meta, files, turns, done } = state;
  const agentIndex = agentView ? agents.findIndex((a) => a.agentId === agentView) : -1;
  const agent = agentIndex >= 0 ? agents[agentIndex] : undefined;
  const messagesActive = tab === "messages";
  return (
    <TooltipProvider delayDuration={300}>
      <AgentsContext.Provider value={agentsValue}>
        <div className="flex flex-col h-full min-h-0">
          <Header
            meta={meta}
            turnCount={meta.messageCount}
            openAt={openAt}
            onOpenAtChange={changeOpenAt}
            agents={agents}
            onOpenAgent={openAgent}
          />
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "messages" | "files")}
            className="px-4 shrink-0 min-w-0 overflow-x-auto overflow-y-hidden"
          >
            <TabsList className="flex-nowrap">
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="files">Files changed ({files.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className={messagesActive ? "flex-1 min-h-0 relative" : "hidden"}>
            {/* The main list stays laid out underneath so its scroll position survives the agent view. */}
            <div className={cn("absolute inset-0 flex flex-col min-h-0", agent && "invisible pointer-events-none")}>
              {turns.length === 0 && done ? (
                <Center>
                  <span className="text-muted-foreground">This session has no displayable messages.</span>
                </Center>
              ) : (
                <MessagesView
                  turns={turns}
                  loadingMore={!done}
                  active={messagesActive && !agent}
                  openAt={openAt}
                  jumpKey={jumpKey}
                />
              )}
            </div>
            {agent && (
              <div className="absolute inset-0 flex flex-col min-h-0 bg-background">
                <AgentView
                  key={agent.agentId}
                  agent={agent}
                  position={agentIndex}
                  count={agents.length}
                  load={agentLoads[agent.agentId]}
                  active={messagesActive}
                  openAt={openAt}
                  jumpKey={jumpKey}
                  onBack={closeAgent}
                  onStep={(delta) => {
                    const next = agents[agentIndex + delta];
                    if (next) openAgent(next.agentId);
                  }}
                />
              </div>
            )}
          </div>
          <div className={tab === "files" ? "flex-1 min-h-0" : "hidden"}>
            <FilesTab files={files} merging={filesScope === "merging"} agentCount={agents.length} />
          </div>
        </div>
      </AgentsContext.Provider>
    </TooltipProvider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex flex-col items-center justify-center gap-2 p-6">{children}</div>;
}
