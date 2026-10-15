import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OpenAt } from "@shared/openAt";
import type { Turn } from "@shared/types";
import { applyFilters, buildRows, findMatches, type Filters } from "@/lib/search";
import { MessageList } from "./MessageList";
import { DEFAULT_FILTERS, SearchBar } from "./SearchBar";

interface Props {
  turns: Turn[];
  loadingMore: boolean;
  active: boolean;
  openAt: OpenAt;
  jumpKey: number;
  /** Where to render the search bar; without one it sits in its own row above the list. */
  searchSlot?: HTMLElement | null;
}

export function MessagesView({ turns, loadingMore, active, openAt, jumpKey, searchSlot }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [cur, setCur] = useState(0);
  const [scrollKey, setScrollKey] = useState(0);
  // Explicit open/closed choices per "Worked for" fold; kept for as long as the panel lives.
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => applyFilters(turns, filters), [turns, filters]);
  const matches = useMemo(() => findMatches(visible, query), [visible, query]);
  const { rows, rowOf } = useMemo(() => buildRows(visible, matches, expanded), [visible, matches, expanded]);

  useEffect(() => {
    setCur(0);
  }, [query, filters]);

  // The fold reports what it currently shows, since a search hit can open it without an explicit choice.
  const toggleFold = useCallback((key: string, open: boolean) => {
    setExpanded((m) => new Map(m).set(key, open));
  }, []);

  // Read through a ref so revealTurn stays stable and only a change of match re-opens a fold.
  const rowModelRef = useRef({ rows, rowOf });
  rowModelRef.current = { rows, rowOf };

  /** Make sure the fold that holds the given visible turn is open, so a match inside can be scrolled to. */
  const revealTurn = useCallback((turnIndex: number) => {
    const { rows, rowOf } = rowModelRef.current;
    const row = rows[rowOf[turnIndex]];
    if (row?.kind === "fold" && !row.open) {
      setExpanded((m) => new Map(m).set(row.key, true));
    }
  }, []);

  const goto = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const next = (cur + delta + matches.length) % matches.length;
      revealTurn(matches[next].turnIndex);
      setCur(next);
      setScrollKey((k) => k + 1);
    },
    [matches, cur, revealTurn],
  );

  const current = matches.length > 0 ? matches[Math.min(cur, matches.length - 1)] : undefined;

  // A new current match (fresh query, or a filter change) may sit inside a closed fold: open it first.
  useEffect(() => {
    if (current) revealTurn(current.turnIndex);
  }, [current, revealTurn]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const bar = (
    <SearchBar
      ref={inputRef}
      query={query}
      onQueryChange={setQuery}
      matchCount={matches.length}
      current={Math.min(cur, Math.max(0, matches.length - 1))}
      onNext={() => goto(1)}
      onPrev={() => goto(-1)}
      filters={filters}
      onFiltersChange={setFilters}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {searchSlot ? (
        createPortal(bar, searchSlot)
      ) : (
        <div className="flex items-center px-3 py-1.5 border-b border-border bg-background min-w-0 shrink-0">{bar}</div>
      )}
      <MessageList
        rows={rows}
        rowOf={rowOf}
        query={query}
        current={current}
        scrollKey={scrollKey}
        loadingMore={loadingMore}
        openAt={openAt}
        jumpKey={jumpKey}
        onToggleFold={toggleFold}
      />
    </div>
  );
}
