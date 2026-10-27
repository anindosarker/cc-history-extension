import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_OPEN_AT, type OpenAt } from "@shared/openAt";
import type { HostToWebview } from "@shared/protocol";
import type { FileChange, SessionMeta, SubagentInfo, Turn, WorkflowRun } from "@shared/types";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentsContext } from "@/lib/agents";
import type { Appended } from "@/lib/live";
import { applyThemeTokens } from "@/lib/themeTokens";
import { cn } from "@/lib/utils";
import { post } from "@/lib/vscode";
import { AgentView, type AgentLoad } from "./components/AgentView";
import { FilesTab } from "./components/FilesTab";
import { Header } from "./components/Header";
import { MessagesView } from "./components/MessagesView";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      meta: SessionMeta;
      files: FileChange[];
      turns: Turn[];
      total: number;
      done: boolean;
      /** Last batch of turns that arrived after the first load (live tail or reload). */
      appended?: Appended;
    };

/** Whether the Files tab still shows main-only changes, is collecting subagent edits, or has them. */
type FilesScope = "main" | "merging" | "merged";

/** A reload in progress: the new turns collect here and replace the shown ones only once complete. */
interface Reload {
  meta: SessionMeta;
  files: FileChange[];
  turns: Turn[];
}

function countMessages(turns: readonly Turn[]): number {
  let n = 0;
  for (const t of turns) if (t.kind === "user" || t.kind === "assistant") n++;
  return n;
}

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tab, setTab] = useState<"messages" | "files">("messages");
  const [openAt, setOpenAt] = useState<OpenAt>(DEFAULT_OPEN_AT);
  // Bumped on each user toggle so the list jumps right away, before the host acks.
  const [jumpKey, setJumpKey] = useState(0);
  const [agents, setAgents] = useState<SubagentInfo[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [agentView, setAgentView] = useState<string | undefined>(undefined);
  // The open agent came from the agents menu, so its back control reopens that menu.
  const [fromMenu, setFromMenu] = useState(false);
  const [menuReopen, setMenuReopen] = useState(0);
  const [agentLoads, setAgentLoads] = useState<Record<string, AgentLoad>>({});
  const [filesScope, setFilesScope] = useState<FilesScope>("main");
  const [live, setLive] = useState(false);
  // Row 2 of the header; the main messages view renders its search bar into it.
  const [searchSlot, setSearchSlot] = useState<HTMLDivElement | null>(null);
  const reload = useRef<Reload | undefined>(undefined);
  const agentViewRef = useRef(agentView);
  agentViewRef.current = agentView;
  const filesScopeRef = useRef(filesScope);
  filesScopeRef.current = filesScope;

  useEffect(() => {
    const finishReload = () => {
      const r = reload.current;
      if (!r) return;
      reload.current = undefined;
      setState((s) => {
        const prev = s.status === "loaded" ? s : undefined;
        const seq = (prev?.appended?.seq ?? 0) + 1;
        const added = prev ? countMessages(r.turns) - countMessages(prev.turns) : 0;
        return { status: "loaded", meta: r.meta, files: r.files, turns: r.turns, total: r.turns.length, done: true, appended: { seq, added } };
      });
      // The host dropped its parsed agents with the reload; the open one is fetched again.
      setAgentLoads({});
      const open = agentViewRef.current;
      if (open) {
        post({ type: "loadAgent", agentId: open });
        setAgentLoads({ [open]: { status: "loading" } });
      }
      post({ type: "listAgents" });
      if (filesScopeRef.current !== "main") {
        setFilesScope("merging");
        post({ type: "loadFiles" });
      }
    };
    const onMessage = (e: MessageEvent<HostToWebview>) => {
      const msg = e.data;
      switch (msg.type) {
        case "loading":
          reload.current = undefined;
          setState({ status: "loading" });
          break;
        case "error":
          reload.current = undefined;
          setState({ status: "error", message: msg.message });
          break;
        case "openAt":
          setOpenAt(msg.value);
          break;
        case "live":
          setLive(msg.live);
          break;
        case "sessionStart":
          setOpenAt(msg.openAt);
          if (msg.reload) {
            reload.current = { meta: msg.meta, files: msg.files, turns: new Array<Turn>(msg.totalTurns) };
            if (msg.totalTurns === 0) finishReload();
            break;
          }
          reload.current = undefined;
          setAgents([]);
          setWorkflows([]);
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
        case "sessionTurns": {
          const r = reload.current;
          if (r) {
            for (let i = 0; i < msg.turns.length; i++) r.turns[msg.offset + i] = msg.turns[i];
            if (msg.done) finishReload();
            break;
          }
          setState((s) => {
            if (s.status !== "loaded") return s;
            const turns = s.turns.slice();
            for (let i = 0; i < msg.turns.length; i++) turns[msg.offset + i] = msg.turns[i];
            return { ...s, turns, done: msg.done };
          });
          break;
        }
        case "sessionAppend":
          setState((s) => {
            if (s.status !== "loaded" || !s.done) return s;
            const turns = s.turns.slice(0, msg.offset).concat(msg.turns);
            const added = countMessages(turns) - countMessages(s.turns);
            const seq = (s.appended?.seq ?? 0) + 1;
            const files = msg.files && filesScopeRef.current === "main" ? msg.files : s.files;
            return { ...s, meta: msg.meta, turns, files, total: turns.length, appended: { seq, added } };
          });
          if (filesScopeRef.current === "merged") setFilesScope("merging");
          break;
        case "agents":
          setAgents(msg.list);
          setWorkflows(msg.workflows);
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
        case "agentAppend":
          setAgentLoads((m) => {
            const cur = m[msg.agentId];
            if (!cur || cur.status !== "loaded" || !cur.done) return m;
            const turns = cur.turns.slice(0, msg.offset).concat(msg.turns);
            const added = countMessages(turns) - countMessages(cur.turns);
            const seq = (cur.appended?.seq ?? 0) + 1;
            return { ...m, [msg.agentId]: { ...cur, turns, total: turns.length, tokens: msg.tokens, appended: { seq, added } } };
          });
          break;
        case "agentError":
          setAgentLoads((m) => ({ ...m, [msg.agentId]: { status: "error", message: msg.message } }));
          break;
        case "files":
          setFilesScope("merged");
          setState((s) => (s.status === "loaded" ? { ...s, files: msg.files } : s));
          break;
        case "themeTokens":
          applyThemeTokens(document.documentElement.style, msg.colors);
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

  const reloadSession = useCallback(() => post({ type: "reloadSession" }), []);

  const showAgent = useCallback((agentId: string) => {
    setTab("messages");
    setAgentView(agentId);
    setAgentLoads((m) => {
      if (m[agentId] && m[agentId].status !== "error") return m;
      post({ type: "loadAgent", agentId });
      return { ...m, [agentId]: { status: "loading" } };
    });
  }, []);

  // A spawn link in the transcript; back returns to the transcript.
  const openAgent = useCallback(
    (agentId: string) => {
      setFromMenu(false);
      showAgent(agentId);
    },
    [showAgent],
  );

  const openAgentFromMenu = useCallback(
    (agentId: string) => {
      setFromMenu(true);
      showAgent(agentId);
    },
    [showAgent],
  );

  const closeAgent = useCallback(() => setAgentView(undefined), []);

  const backFromAgent = useCallback(() => {
    setAgentView(undefined);
    if (fromMenu) setMenuReopen((n) => n + 1);
  }, [fromMenu]);

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

  // Direct agents first, then each run's agents in the order the menu lists them.
  const allAgents = useMemo(() => agents.concat(...workflows.map((r) => r.agents)), [agents, workflows]);

  // The Files tab pulls in subagent and workflow agent edits the first time it opens (and again after an append), when there are agents to read.
  useEffect(() => {
    if (tab !== "files" || allAgents.length === 0) return;
    if (filesScope === "main") {
      setFilesScope("merging");
      post({ type: "loadFiles" });
    }
  }, [tab, filesScope, allAgents.length]);

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

  const { meta, files, turns, done, appended } = state;
  const agent = agentView ? allAgents.find((a) => a.agentId === agentView) : undefined;
  // Previous and next step through the list the agent belongs to: its run, or the direct agents.
  const siblings = agent?.runId ? (workflows.find((r) => r.runId === agent.runId)?.agents ?? []) : agents;
  const agentIndex = agent ? siblings.indexOf(agent) : -1;
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
            workflows={workflows}
            onOpenAgent={openAgentFromMenu}
            agentsMenuReopen={menuReopen}
            tab={tab}
            onTabChange={setTab}
            filesCount={files.length}
            search={<div ref={setSearchSlot} className="flex flex-1 min-w-0 items-center" />}
            searchVisible={messagesActive && !agent}
            live={live}
            onReload={reloadSession}
          />
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
                  searchSlot={searchSlot}
                  appended={appended}
                />
              )}
            </div>
            {agent && (
              <div className="absolute inset-0 flex flex-col min-h-0 bg-background">
                <AgentView
                  key={agent.agentId}
                  agent={agent}
                  position={agentIndex}
                  count={siblings.length}
                  load={agentLoads[agent.agentId]}
                  active={messagesActive}
                  openAt={openAt}
                  jumpKey={jumpKey}
                  backLabel={fromMenu ? "Back to the agents list" : undefined}
                  onBack={backFromAgent}
                  onClose={closeAgent}
                  onStep={(delta) => {
                    const next = siblings[agentIndex + delta];
                    if (next) showAgent(next.agentId);
                  }}
                />
              </div>
            )}
          </div>
          <div className={tab === "files" ? "flex-1 min-h-0" : "hidden"}>
            <FilesTab files={files} merging={filesScope === "merging"} agentCount={allAgents.length} />
          </div>
        </div>
      </AgentsContext.Provider>
    </TooltipProvider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex flex-col items-center justify-center gap-2 p-6">{children}</div>;
}
