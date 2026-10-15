import { Fragment, memo } from "react";
import { countOccurrences, escapeRegExp } from "@/lib/search";

interface Props {
  text: string;
  query: string;
  /** Local occurrence index that is the current match, or -1. */
  current?: number;
}

/** Plain text with every case-insensitive query hit wrapped in a mark element. */
export const Highlight = memo(function Highlight({ text, query, current = -1 }: Props) {
  if (!query || countOccurrences(text, query) === 0) return <>{text}</>;
  const re = new RegExp(escapeRegExp(query), "gi");
  const out: React.ReactNode[] = [];
  let last = 0;
  let occ = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(<Fragment key={`t${last}`}>{text.slice(last, i)}</Fragment>);
    out.push(
      <mark key={`m${i}`} data-current={occ === current ? "true" : undefined}>
        {m[0]}
      </mark>,
    );
    occ++;
    last = i + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
});
