import { memo, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Block } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { countOccurrences, toolUseParts } from "@/lib/search";
import { cn } from "@/lib/utils";
import { Highlight } from "./Highlight";

const RESULT_LIMIT = 20_000;

interface Props {
  block: Extract<Block, { type: "tool_use" }>;
  query: string;
  /** Occurrence index within the whole block (chip, input, result), or -1. */
  current: number;
}

export const ToolUseBlock = memo(function ToolUseBlock({ block, query, current }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (current >= 0) setOpen(true);
  }, [current]);

  const [chip, input, result] = toolUseParts(block);
  const chipCount = query ? countOccurrences(chip, query) : 0;
  const inputCount = query ? countOccurrences(input, query) : 0;
  const chipCurrent = current >= 0 && current < chipCount ? current : -1;
  const inputCurrent = current >= chipCount && current < chipCount + inputCount ? current - chipCount : -1;
  const resultCurrent = current >= chipCount + inputCount ? current - chipCount - inputCount : -1;
  const isError = block.result?.isError === true;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "tool-pill inline-flex max-w-full items-center gap-1 rounded-[6px] border px-2 py-[3px] text-[11px] leading-none text-left text-muted-foreground hover:text-foreground cursor-pointer select-none",
            isError && "border-destructive/50",
          )}
          title={`${block.name} ${block.summary}`}
        >
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="shrink-0">
            <Highlight text={block.name} query={query} current={chipCurrent} />
          </span>
          <span className="min-w-0 truncate font-mono opacity-80">
            <Highlight
              text={block.summary}
              query={query}
              current={chipCurrent >= 0 ? chipCurrent - countOccurrences(block.name, query) : -1}
            />
          </span>
          {isError && <span className="shrink-0 text-destructive">error</span>}
          {block.result === undefined && <span className="shrink-0 opacity-70">no result</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-2">
          <Section label="Input">
            <pre className="tool-pre mono-pre max-h-80 overflow-auto scroll-thin rounded-[6px] border p-2 text-muted-foreground">
              <Highlight text={input} query={query} current={inputCurrent} />
            </pre>
          </Section>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground mb-1 select-none">{label}</div>
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
          "tool-pre mono-pre max-h-[60vh] overflow-auto scroll-thin rounded-[6px] border p-2 text-muted-foreground",
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
          <span className="text-[11px] text-muted-foreground">Result trimmed at 200,000 characters.</span>
        )}
      </div>
    </div>
  );
}
