import { memo, useEffect, useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import type { Block } from "@shared/types";
import { Badge } from "@/components/ui/badge";
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-left hover:bg-accent cursor-pointer select-none",
            isError && "border-destructive/50",
          )}
          title={`${block.name} ${block.summary}`}
        >
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-semibold shrink-0">
            <Highlight text={block.name} query={query} current={chipCurrent} />
          </span>
          <span className="min-w-0 truncate text-muted-foreground font-mono text-[0.92em]">
            <Highlight
              text={block.summary}
              query={query}
              current={chipCurrent >= 0 ? chipCurrent - countOccurrences(block.name, query) : -1}
            />
          </span>
          {isError && <Badge variant="destructive">error</Badge>}
          {block.result === undefined && <Badge variant="muted">no result</Badge>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-1 flex flex-col gap-1.5 border-l-2 border-border pl-2">
          <Section label="Input">
            <pre className="mono-pre max-h-80 overflow-auto scroll-thin rounded-md bg-code border border-border p-2">
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
    <div>
      <div className="text-[0.85em] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
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
          "mono-pre max-h-[60vh] overflow-auto scroll-thin rounded-md border p-2",
          isError ? "bg-destructive/10 border-destructive/40" : "bg-code border-border",
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
          <span className="text-[0.85em] text-muted-foreground">Result trimmed at 200,000 characters.</span>
        )}
      </div>
    </div>
  );
}
