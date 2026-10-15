import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_OPEN_AT, type OpenAt } from "@shared/openAt";
import type { HostToWebview } from "@shared/protocol";
import type { FileChange, SessionMeta, Turn } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { post } from "@/lib/vscode";
import { FilesTab } from "./components/FilesTab";
import { Header } from "./components/Header";
import { MessagesView } from "./components/MessagesView";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; meta: SessionMeta; files: FileChange[]; turns: Turn[]; total: number; done: boolean };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tab, setTab] = useState<"messages" | "files">("messages");
  const [openAt, setOpenAt] = useState<OpenAt>(DEFAULT_OPEN_AT);
  // Bumped on each user toggle so the list jumps right away, before the host acks.
  const [jumpKey, setJumpKey] = useState(0);

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
          setState({
            status: "loaded",
            meta: msg.meta,
            files: msg.files,
            turns: [],
            total: msg.totalTurns,
            done: msg.totalTurns === 0,
          });
          break;
        case "sessionTurns":
          setState((s) => {
            if (s.status !== "loaded") return s;
            const turns = s.turns.slice();
            for (let i = 0; i < msg.turns.length; i++) turns[msg.offset + i] = msg.turns[i];
            return { ...s, turns, done: msg.done };
          });
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

  const { meta, files, turns, total, done } = state;
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full min-h-0">
        <Header meta={meta} turnCount={total} openAt={openAt} onOpenAtChange={changeOpenAt} />
        <Tabs value={tab} onValueChange={(v) => setTab(v as "messages" | "files")} className="px-4 shrink-0">
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="files">Files changed ({files.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className={tab === "messages" ? "flex-1 min-h-0" : "hidden"}>
          {turns.length === 0 && done ? (
            <Center>
              <span className="text-muted-foreground">This session has no displayable messages.</span>
            </Center>
          ) : (
            <MessagesView
              turns={turns}
              loadingMore={!done}
              active={tab === "messages"}
              openAt={openAt}
              jumpKey={jumpKey}
            />
          )}
        </div>
        <div className={tab === "files" ? "flex-1 min-h-0" : "hidden"}>
          <FilesTab files={files} />
        </div>
      </div>
    </TooltipProvider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex flex-col items-center justify-center gap-2 p-6">{children}</div>;
}
