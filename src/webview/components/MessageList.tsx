import { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { OpenAt } from "@shared/openAt";
import type { Match, VisibleTurn } from "@/lib/search";
import { TurnRow } from "./TurnRow";

interface Props {
  items: VisibleTurn[];
  query: string;
  current: Match | undefined;
  /** Changes whenever the current match should be scrolled to again. */
  scrollKey: number;
  loadingMore: boolean;
  openAt: OpenAt;
  /** Changes whenever the user flips the Old | New toggle. */
  jumpKey: number;
}

/** How long to keep nudging toward the bottom while rows are still being measured. */
const SETTLE_ATTEMPTS = 40;
const SETTLE_INTERVAL_MS = 32;

export function MessageList({ items, query, current, scrollKey, loadingMore, openAt, jumpKey }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 6,
    getItemKey: (i) => items[i]?.turn.uuid ?? i,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  const itemCountRef = useRef(items.length);
  itemCountRef.current = items.length;
  const cancelJump = useRef<(() => void) | undefined>(undefined);
  const initialJumpDone = useRef(false);

  /**
   * Scroll to the top or bottom. The bottom case re-runs until the scroll position stops
   * moving, because row heights are only measured once rows render.
   */
  const jumpTo = useCallback((edge: "top" | "bottom") => {
    cancelJump.current?.();
    const el = parentRef.current;
    if (!el) return;
    if (edge === "top") {
      virtualizerRef.current.scrollToIndex(0, { align: "start" });
      el.scrollTop = 0;
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let stableChecks = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      if (cancelled) return;
      const last = itemCountRef.current - 1;
      if (last < 0) return;
      virtualizerRef.current.scrollToIndex(last, { align: "end" });
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (cancelled) return;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
        stableChecks = atBottom ? stableChecks + 1 : 0;
        attempts++;
        if (stableChecks >= 3 || attempts >= SETTLE_ATTEMPTS) return;
        timer = setTimeout(step, SETTLE_INTERVAL_MS);
      });
    };
    cancelJump.current = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    step();
  }, []);

  // Initial position once every turn has arrived.
  useEffect(() => {
    if (loadingMore || items.length === 0 || initialJumpDone.current) return;
    initialJumpDone.current = true;
    if (openAt === "newest") jumpTo("bottom");
  }, [loadingMore, items.length, openAt, jumpTo]);

  // Live toggle.
  useEffect(() => {
    if (jumpKey === 0) return;
    jumpTo(openAt === "newest" ? "bottom" : "top");
    // openAt is read when the key changes; it is updated in the same render as the key.
  }, [jumpKey, jumpTo]);

  useEffect(() => {
    if (!current) return;
    cancelJump.current?.();
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

  useEffect(() => () => cancelJump.current?.(), []);

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
