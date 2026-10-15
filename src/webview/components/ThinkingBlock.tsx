import { memo, useEffect, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Highlight } from "./Highlight";

const LIMIT = 10_000;

interface Props {
  text: string;
  query: string;
  current: number;
  hasMatch: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({ text, query, current, hasMatch }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (current >= 0) setOpen(true);
  }, [current]);
  const tooLong = text.length > LIMIT;
  const showFull = !tooLong || expanded || hasMatch;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-l-2 border-thinking/60 pl-2">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer select-none"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          <Brain className="size-3.5" />
          <span className="italic">Thinking</span>
          {hasMatch && !open && <span className="text-[0.85em]">(match)</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 text-muted-foreground whitespace-pre-wrap break-words italic">
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
