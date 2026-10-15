import { memo, useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { OpenAll } from "@/lib/search";
import { Highlight } from "./Highlight";

const LIMIT = 10_000;

interface Props {
  text: string;
  query: string;
  current: number;
  hasMatch: boolean;
  openAll?: OpenAll;
}

/** A single faint "Thinking…" line; the thinking text unfolds below it on click. */
export const ThinkingBlock = memo(function ThinkingBlock({ text, query, current, hasMatch, openAll }: Props) {
  const [open, setOpen] = useState(openAll?.seq ? openAll.open : false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (current >= 0) setOpen(true);
  }, [current]);
  useEffect(() => {
    if (openAll?.seq) setOpen(openAll.open);
  }, [openAll?.seq, openAll?.open]);
  const tooLong = text.length > LIMIT;
  const showFull = !tooLong || expanded || hasMatch;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="tier-2 min-w-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="thinking-line tier-hover italic leading-snug cursor-pointer select-none"
          aria-expanded={open}
        >
          Thinking…
          {hasMatch && !open && <span className="not-italic text-[11px]"> (match)</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 leading-[1.55] whitespace-pre-wrap break-words italic">
          <Highlight text={showFull ? text : text.slice(0, LIMIT)} query={query} current={current} />
        </div>
        {tooLong && !hasMatch && (
          <Button variant="link" size="sm" className="px-0 mt-1" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : `Show all ${text.length.toLocaleString()} characters`}
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});
