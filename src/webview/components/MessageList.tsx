import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Match, VisibleTurn } from "@/lib/search";
import { TurnRow } from "./TurnRow";

interface Props {
  items: VisibleTurn[];
  query: string;
  current: Match | undefined;
  /** Changes whenever the current match should be scrolled to again. */
  scrollKey: number;
  loadingMore: boolean;
}

export function MessageList({ items, query, current, scrollKey, loadingMore }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 6,
    getItemKey: (i) => items[i]?.turn.uuid ?? i,
  });

  useEffect(() => {
    if (!current) return;
    virtualizer.scrollToIndex(current.turnIndex, { align: "center" });
    // Rows are measured after paint, so give the virtualizer a moment before locating the mark.
    const t = setTimeout(() => {
      virtualizer.scrollToIndex(current.turnIndex, { align: "center" });
      requestAnimationFrame(() => {
        const el = parentRef.current?.querySelector('mark[data-current="true"]');
        el?.scrollIntoView({ block: "center" });
      });
    }, 60);
    return () => clearTimeout(t);
  }, [current?.turnIndex, current?.blockIndex, current?.occ, scrollKey]);

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-thin">
      {items.length === 0 ? (
        <div className="p-6 text-muted-foreground text-center">No messages match the current filters.</div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualItems.map((vi) => {
            const item = items[vi.index];
            const isCurrentTurn = current?.turnIndex === vi.index;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <TurnRow
                  item={item}
                  query={query}
                  currentBlock={isCurrentTurn && current ? current.blockIndex : -1}
                  currentOcc={isCurrentTurn && current ? current.occ : -1}
                />
              </div>
            );
          })}
        </div>
      )}
      {loadingMore && <div className="p-3 text-center text-muted-foreground">Loading more messages…</div>}
    </div>
  );
}
