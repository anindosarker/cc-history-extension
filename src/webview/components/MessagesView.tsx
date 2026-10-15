import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Turn } from "@shared/types";
import { applyFilters, findMatches, type Filters } from "@/lib/search";
import { MessageList } from "./MessageList";
import { SearchBar } from "./SearchBar";

interface Props {
  turns: Turn[];
  loadingMore: boolean;
  active: boolean;
}

export function MessagesView({ turns, loadingMore, active }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({ role: "all", showThinking: true, showTools: true });
  const [cur, setCur] = useState(0);
  const [scrollKey, setScrollKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => applyFilters(turns, filters), [turns, filters]);
  const matches = useMemo(() => findMatches(visible, query), [visible, query]);

  useEffect(() => {
    setCur(0);
  }, [query, filters]);

  const goto = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setCur((c) => (c + delta + matches.length) % matches.length);
      setScrollKey((k) => k + 1);
    },
    [matches.length],
  );

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

  const current = matches.length > 0 ? matches[Math.min(cur, matches.length - 1)] : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
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
      <MessageList items={visible} query={query} current={current} scrollKey={scrollKey} loadingMore={loadingMore} />
    </div>
  );
}
