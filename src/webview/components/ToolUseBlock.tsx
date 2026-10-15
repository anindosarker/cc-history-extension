import { memo, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { editCounts, editLines } from "@shared/editStats";
import { parseFileRef } from "@shared/fileRef";
import { displayToolName } from "@shared/toolSummary";
import type { Block } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { agentForToolUse, useAgents } from "@/lib/agents";
import { countOccurrences, toolUseParts, type OpenAll } from "@/lib/search";
import { AGENT_TOOLS, toolStatus } from "@/lib/toolStatus";
import { cn } from "@/lib/utils";
import { Highlight } from "./Highlight";
import { openFileRef } from "./Markdown";

const RESULT_LIMIT = 20_000;
/** Tools whose summary is the file they touched, shown as a link to that file. */
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

interface Props {
  block: Extract<Block, { type: "tool_use" }>;
  query: string;
  /** Occurrence index within the whole block (chip, input, result), or -1. */
  current: number;
  openAll?: OpenAll;
  /** Narrow content column: a file path gets its own line under the "Used <tool>" trigger. */
  narrow?: boolean;
}

/** Left-to-right mark; wrapping a right-to-left truncated path in these keeps its slashes in place. */
const LRM = "\u200e";

export const ToolUseBlock = memo(function ToolUseBlock({ block, query, current, openAll, narrow = false }: Props) {
  const [open, setOpen] = useState(openAll?.seq ? openAll.open : false);
  useEffect(() => {
    if (current >= 0) setOpen(true);
  }, [current]);
  useEffect(() => {
    if (openAll?.seq) setOpen(openAll.open);
  }, [openAll?.seq, openAll?.open]);

  const [chip, input, result] = toolUseParts(block);
  const chipCount = query ? countOccurrences(chip, query) : 0;
  const inputCount = query ? countOccurrences(input, query) : 0;
  const chipCurrent = current >= 0 && current < chipCount ? current : -1;
  const inputCurrent = current >= chipCount && current < chipCount + inputCount ? current - chipCount : -1;
  const resultCurrent = current >= chipCount + inputCount ? current - chipCount - inputCount : -1;
  const isError = block.result?.isError === true;
  const { agents, openAgent } = useAgents();
  const spawned = agentForToolUse(agents, block);
  const fileRef = FILE_TOOLS.has(block.name) ? parseFileRef(block.summary) : undefined;
  const summaryCurrent = chipCurrent >= 0 ? chipCurrent - countOccurrences(block.name, query) : -1;
  const summary = <Highlight text={block.summary} query={query} current={summaryCurrent} />;
  // Search indexes the full name; the hidden prefix keeps the marks (and their count) in the DOM.
  const shortName = displayToolName(block.name);
  const prefix = block.name.slice(0, block.name.length - shortName.length);
  const prefixCount = query ? countOccurrences(prefix, query) : 0;
  const stacked = narrow && fileRef !== undefined;
  const status = toolStatus(block);
  const dot = AGENT_TOOLS.has(block.name) ? "agent" : status;
  const counts = editCounts(block.name, block.input);
  const diff = open ? editLines(block.name, block.input) : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="tier-2 min-w-0">
      <div className={cn("flex gap-2 min-w-0", stacked ? "flex-col items-start gap-0.5" : "items-center")} data-stacked={stacked || undefined}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "tool-line tier-hover flex min-w-0 max-w-full items-center gap-1.5 leading-snug text-left cursor-pointer select-none",
              // Next to a path button the trigger keeps its own text; alone it may truncate the name.
              fileRef && !stacked && "shrink-0",
            )}
            title={`${block.name} ${block.summary}`}
            aria-expanded={open}
          >
            <span className="tool-dot" data-status={dot} aria-hidden="true" />
            <span className={cn("tool-name", fileRef ? "shrink-0" : "min-w-0 truncate")} title={shortName === block.name ? undefined : block.name}>
              {"Used "}
              {prefix && (
                <span className="sr-only">
                  <Highlight text={prefix} query={query} current={chipCurrent} />
                </span>
              )}
              <span className="tool-fn">
                <Highlight text={shortName} query={query} current={chipCurrent >= 0 ? chipCurrent - prefixCount : -1} />
              </span>
            </span>
            {isError && <span className="shrink-0 text-[11px] text-destructive">failed</span>}
            <ChevronRight className={cn("size-3 shrink-0 tier-3 transition-transform", open && "rotate-90")} />
            {!fileRef && (
              <span className={cn("min-w-0 flex-1 basis-0 truncate", block.name === "Bash" ? "tool-bash" : "tier-3")}>
                {summary}
              </span>
            )}
            {block.result === undefined && <span className="shrink-0 text-[11px] tier-3">no result</span>}
          </button>
        </CollapsibleTrigger>
        {fileRef && (
          <button
            type="button"
            className="file-link tool-file tool-path min-w-0 max-w-full truncate tier-3 text-left cursor-pointer hover:underline"
            onClick={() => openFileRef(fileRef)}
            title={`Open ${fileRef.path}`}
          >
            {LRM}
            {summary}
            {LRM}
          </button>
        )}
        {counts && (
          <span className="shrink-0 text-[11px] tabular-nums whitespace-nowrap select-none" title="Lines added and removed">
            <span className="text-added">{`+${counts.added}`}</span>
            {counts.removed !== undefined && <span className="text-removed">{` −${counts.removed}`}</span>}
          </span>
        )}
        {spawned && (
          <button
            type="button"
            className="agent-name shrink-0 text-[11px] hover:underline cursor-pointer"
            onClick={() => openAgent(spawned.agentId)}
            title={`Open the ${spawned.name} transcript`}
          >
            Open transcript
          </button>
        )}
      </div>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-2">
          {diff ? (
            <Section label={block.name === "Write" || block.name === "NotebookEdit" ? "Content" : "Edit"}>
              <MiniDiff blocks={diff} />
            </Section>
          ) : (
            <Section label="Input">
              <pre className="tool-pre mono-pre max-h-80 overflow-auto scroll-thin rounded-[6px] border p-2">
                <Highlight text={input} query={query} current={inputCurrent} />
              </pre>
            </Section>
          )}
          {block.result && (
            <Section label={isError ? "Result (error)" : "Result"}>
              <ResultPre
                text={result}
                truncatedByHost={block.result.truncated === true}
                isError={isError}
                query={query}
                current={resultCurrent}
              />
            </Section>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

/** Removed lines on a red tint, added lines on a green tint; one block per old/new pair. */
function MiniDiff({ blocks }: { blocks: { removed: string[]; added: string[] }[] }) {
  return (
    <div className="mini-diff tool-pre max-h-[60vh] overflow-auto scroll-thin rounded-[6px] border py-1">
      {blocks.map((b, i) => (
        <div key={i} className="block">
          {b.removed.map((l, k) => (
            <div key={`d${k}`} className="line" data-kind="del">
              {`- ${l}`}
            </div>
          ))}
          {b.added.map((l, k) => (
            <div key={`a${k}`} className="line" data-kind="add">
              {`+ ${l}`}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] tier-3 mb-1 select-none">{label}</div>
      {children}
    </div>
  );
}

function ResultPre({
  text,
  truncatedByHost,
  isError,
  query,
  current,
}: {
  text: string;
  truncatedByHost: boolean;
  isError: boolean;
  query: string;
  current: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > RESULT_LIMIT;
  const visibleCount = query && tooLong ? countOccurrences(text.slice(0, RESULT_LIMIT), query) : 0;
  const needFull = current >= 0 && current >= visibleCount;
  const showFull = !tooLong || expanded || needFull;
  return (
    <div>
      <pre
        className={cn(
          "tool-pre mono-pre max-h-[60vh] overflow-auto scroll-thin rounded-[6px] border p-2",
          isError && "border-destructive/40",
        )}
      >
        <Highlight text={showFull ? text : text.slice(0, RESULT_LIMIT)} query={query} current={current} />
        {!showFull && "…"}
      </pre>
      <div className="flex items-center gap-2 mt-0.5">
        {tooLong && !needFull && (
          <Button variant="link" size="sm" className="px-0" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show more (${text.length.toLocaleString()} characters)`}
          </Button>
        )}
        {truncatedByHost && (
          <span className="text-[11px] tier-3">Result trimmed at 200,000 characters.</span>
        )}
      </div>
    </div>
  );
}
