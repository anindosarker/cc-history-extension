import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpenAt } from "@shared/openAt";
import { nearBottomRight, scrollButtonsFor, type ScrollButtons } from "@/lib/scrollButtons";
import { atBottom, atTop, SETTLE_START, settleNext } from "@/lib/settle";
import type { Match, Row } from "@/lib/search";
import { useContainerWidth } from "@/lib/useContainerWidth";
import { cn } from "@/lib/utils";
import { DateRow } from "./DateRow";
import { FoldRow } from "./FoldRow";
import { TurnRow } from "./TurnRow";

interface Props {
  rows: Row[];
  /** Row index for each visible turn index, so a match can be scrolled to through its fold. */
  rowOf: number[];
  query: string;
  current: Match | undefined;
  /** Changes whenever the current match should be scrolled to again. */
  scrollKey: number;
  loadingMore: boolean;
  openAt: OpenAt;
  /** Changes whenever the user flips the Old | New toggle. */
  jumpKey: number;
  onToggleFold: (key: string, open: boolean) => void;
}

/** How long the scroll buttons stay after the last scroll event. */
const SCROLL_LINGER_MS = 1500;
/** Longest we wait for a smooth scroll to finish before the settle loop takes over. */
const SMOOTH_FALLBACK_MS = 700;
/** From this list width on, the buttons sit in the right gutter outside the 960px content column. */
const GUTTER_WIDTH = 1040;
/** Below this list width the content column (16px gutters) is under 480px and tool lines stack their file path. */
const NARROW_WIDTH = 512;

export function MessageList({
  rows,
  rowOf,
  query,
  current,
  scrollKey,
  loadingMore,
  openAt,
  jumpKey,
  onToggleFold,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const r = rows[i];
      if (!r) return 140;
      if (r.kind === "date") return 20;
      return r.kind === "fold" && !r.open ? 28 : 160;
    },
    overscan: 6,
    getItemKey: (i) => rows[i]?.key ?? i,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  const itemCountRef = useRef(rows.length);
  itemCountRef.current = rows.length;
  const rowOfRef = useRef(rowOf);
  rowOfRef.current = rowOf;
  const cancelJump = useRef<(() => void) | undefined>(undefined);
  const initialJumpDone = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(wrapRef);

  // Scroll buttons: which edges are reachable, and whether the user is scrolling or near the corner.
  const [edges, setEdges] = useState<ScrollButtons>({ up: false, down: false });
  const [scrolling, setScrolling] = useState(false);
  const [nearCorner, setNearCorner] = useState(false);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const measureEdges = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const next = scrollButtonsFor(el.scrollTop, el.scrollHeight, el.clientHeight);
    setEdges((cur) => (cur.up === next.up && cur.down === next.down ? cur : next));
  }, []);

  const onScroll = useCallback(() => {
    measureEdges();
    setScrolling(true);
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    lingerTimer.current = setTimeout(() => setScrolling(false), SCROLL_LINGER_MS);
  }, [measureEdges]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = parentRef.current;
    if (!el) return;
    setNearCorner(nearBottomRight(e.clientX, e.clientY, el.getBoundingClientRect()));
  }, []);

  // Edges change as rows get measured and as the list grows, not only on scroll.
  useEffect(() => {
    measureEdges();
  });
  useEffect(
    () => () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    },
    [],
  );

  /**
   * Scroll to the top or bottom and keep re-asserting the edge every frame until it holds for a few
   * frames (see lib/settle): rows re-measure as they render, and the virtualizer's own scroll
   * adjustments would otherwise leave the list short of the edge.
   */
  const jumpTo = useCallback((edge: "top" | "bottom") => {
    cancelJump.current?.();
    const el = parentRef.current;
    if (!el) return;
    let cancelled = false;
    let raf: number | undefined;
    let state = SETTLE_START;
    const assertEdge = () => {
      const last = itemCountRef.current - 1;
      if (last < 0) return false;
      if (edge === "top") {
        virtualizerRef.current.scrollToIndex(0, { align: "start" });
        el.scrollTop = 0;
      } else {
        virtualizerRef.current.scrollToIndex(last, { align: "end" });
        el.scrollTop = el.scrollHeight;
      }
      return true;
    };
    const step = () => {
      if (cancelled || !assertEdge()) return;
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const at = edge === "top" ? atTop(el.scrollTop) : atBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
        state = settleNext(state, at);
        if (state.done) return;
        raf = requestAnimationFrame(step);
      });
    };
    cancelJump.current = () => {
      cancelled = true;
      if (raf !== undefined) cancelAnimationFrame(raf);
    };
    step();
  }, []);

  /** Smooth version for the buttons and Home/End; the settle loop takes over once the glide ends. */
  const glideTo = useCallback(
    (edge: "top" | "bottom") => {
      const el = parentRef.current;
      if (!el) return;
      cancelJump.current?.();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("scrollend", finish);
        clearTimeout(timer);
        jumpTo(edge);
      };
      // scrollend may never fire when the virtualizer interrupts the glide, so a timer backs it up.
      const timer = setTimeout(finish, SMOOTH_FALLBACK_MS);
      cancelJump.current = () => {
        done = true;
        el.removeEventListener("scrollend", finish);
        clearTimeout(timer);
      };
      el.addEventListener("scrollend", finish, { once: true });
      el.scrollTo({ top: edge === "top" ? 0 : el.scrollHeight, behavior: "smooth" });
    },
    [jumpTo],
  );

  // Wheel, touch or pointer input from the user ends any jump in progress instead of fighting it.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const cancel = () => cancelJump.current?.();
    el.addEventListener("wheel", cancel, { passive: true });
    el.addEventListener("touchstart", cancel, { passive: true });
    el.addEventListener("pointerdown", cancel, { passive: true });
    return () => {
      el.removeEventListener("wheel", cancel);
      el.removeEventListener("touchstart", cancel);
      el.removeEventListener("pointerdown", cancel);
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Home" && e.key !== "End") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      glideTo(e.key === "Home" ? "top" : "bottom");
    },
    [glideTo],
  );

  // Initial position once every turn has arrived.
  useEffect(() => {
    if (loadingMore || rows.length === 0 || initialJumpDone.current) return;
    initialJumpDone.current = true;
    if (openAt === "newest") jumpTo("bottom");
  }, [loadingMore, rows.length, openAt, jumpTo]);

  // Live toggle.
  useEffect(() => {
    if (jumpKey === 0) return;
    jumpTo(openAt === "newest" ? "bottom" : "top");
    // openAt is read when the key changes; it is updated in the same render as the key.
  }, [jumpKey, jumpTo]);

  useEffect(() => {
    if (!current) return;
    cancelJump.current?.();
    const rowIndex = rowOfRef.current[current.turnIndex] ?? current.turnIndex;
    virtualizer.scrollToIndex(rowIndex, { align: "center" });
    // Rows are measured after paint (and folds may just have opened), so give the virtualizer
    // a moment before locating the mark.
    const t = setTimeout(() => {
      virtualizer.scrollToIndex(rowIndex, { align: "center" });
      requestAnimationFrame(() => {
        const el = parentRef.current?.querySelector('mark[data-current="true"]');
        el?.scrollIntoView({ block: "center" });
      });
    }, 60);
    return () => clearTimeout(t);
  }, [current?.turnIndex, current?.blockIndex, current?.occ, scrollKey]);

  useEffect(() => () => cancelJump.current?.(), []);

  const virtualItems = virtualizer.getVirtualItems();
  const showButtons = (edges.up || edges.down) && (scrolling || nearCorner);
  const inGutter = width !== undefined && width >= GUTTER_WIDTH;
  const narrow = width !== undefined && width < NARROW_WIDTH;
  return (
    <div
      ref={wrapRef}
      className="relative flex-1 min-h-0 flex flex-col"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setNearCorner(false)}
    >
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-thin outline-none"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        {rows.length === 0 ? (
          <div className="p-6 text-muted-foreground text-center">
            No messages match the current filters.
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualItems.map((vi) => {
              const row = rows[vi.index];
              const isCurrentTurn = row.kind === "turn" && current?.turnIndex === row.visibleIndex;
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
                  {row.kind === "date" ? (
                    <DateRow row={row} />
                  ) : row.kind === "fold" ? (
                    <FoldRow row={row} query={query} current={current} onToggle={onToggleFold} narrow={narrow} />
                  ) : (
                    <TurnRow
                      item={row.item}
                      query={query}
                      currentBlock={isCurrentTurn && current ? current.blockIndex : -1}
                      currentOcc={isCurrentTurn && current ? current.occ : -1}
                      narrow={narrow}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {loadingMore && (
          <div className="p-3 text-center text-muted-foreground">Loading more messages…</div>
        )}
      </div>
      <div
        className={cn(
          "scroll-buttons absolute bottom-3 right-4 flex flex-col gap-1 transition-opacity duration-200",
          showButtons ? (inGutter ? "opacity-100" : "opacity-70") : "opacity-0 pointer-events-none",
        )}
        data-visible={showButtons ? "true" : "false"}
        aria-hidden={!showButtons}
      >
        {edges.up && (
          <ScrollButton label="Scroll to top" onClick={() => glideTo("top")}>
            <ArrowUp />
          </ScrollButton>
        )}
        {edges.down && (
          <ScrollButton label="Scroll to bottom" onClick={() => glideTo("bottom")}>
            <ArrowDown />
          </ScrollButton>
        )}
      </div>
    </div>
  );
}

function ScrollButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="scroll-button size-7 rounded-full bg-background text-muted-foreground hover:text-foreground"
      onClick={onClick}
      aria-label={label}
      title={label}
      tabIndex={-1}
    >
      {children}
    </Button>
  );
}
