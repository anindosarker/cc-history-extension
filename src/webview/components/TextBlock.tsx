import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";

const LIMIT = 10_000;

interface Props {
  text: string;
  query: string;
  current: number;
  hasMatch: boolean;
  /** Claude text: a hover frame and a copy button for the markdown source. User bubbles carry their own. */
  copyable?: boolean;
}

/** Markdown text, truncated when very long unless the user expands it or a search hit lives inside. */
export const TextBlock = memo(function TextBlock({ text, query, current, hasMatch, copyable }: Props) {
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > LIMIT;
  const showFull = !tooLong || expanded || hasMatch;
  return (
    <div className={copyable ? "text-block copy-scope relative rounded-[6px] -mx-2 px-2 -my-1 py-1" : undefined}>
      {copyable && <CopyButton text={text} className="absolute top-0 right-0.5 z-10" />}
      <Markdown text={showFull ? text : text.slice(0, LIMIT)} query={query} current={current} />
      {tooLong && !hasMatch && (
        <Button variant="link" size="sm" className="px-0 mt-1" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `Show all ${text.length.toLocaleString()} characters`}
        </Button>
      )}
    </div>
  );
});
