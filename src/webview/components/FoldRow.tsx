import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { FoldRow as FoldRowModel, Match, OpenAll } from "@/lib/search";
import { formatWorkDuration } from "@/lib/search";
import { cn } from "@/lib/utils";
import { TurnRow } from "./TurnRow";

interface Props {
  row: FoldRowModel;
  query: string;
  current: Match | undefined;
  onToggle: (key: string, open: boolean) => void;
}

/** One-line "Worked for 4m · 12 tool calls" divider; the folded turns unfold in place below it. */
export const FoldRow = memo(function FoldRow({ row, query, current, onToggle }: Props) {
  // Last "Expand all" / "Collapse all" request; seq 0 means nobody asked yet.
  const [openAll, setOpenAll] = useState<OpenAll>({ open: false, seq: 0 });
  const calls = `${row.toolCalls} tool call${row.toolCalls === 1 ? "" : "s"}`;
  const toggleAll = () => {
    const open = !openAll.open;
    setOpenAll({ open, seq: openAll.seq + 1 });
    if (open && !row.open) onToggle(row.key, true);
  };
  return (
    <div className="chat-turn" data-fold={row.key}>
      <div className="flex items-center gap-2 px-4 py-[6px] text-[11px] leading-none text-muted-foreground select-none">
        <button
          type="button"
          className="fold-line flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground cursor-pointer"
          aria-expanded={row.open}
          onClick={() => onToggle(row.key, !row.open)}
        >
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", row.open && "rotate-90")} />
          <span className="shrink-0">{`Worked for ${formatWorkDuration(row.durationMs)}`}</span>
          <span className="shrink-0 opacity-70">{`· ${calls}`}</span>
          {row.hasMatch && !row.open && <span className="shrink-0 opacity-70">(match)</span>}
          <span className="fold-rule h-px flex-1" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="fold-all shrink-0 opacity-60 hover:opacity-100 hover:text-foreground cursor-pointer"
          onClick={toggleAll}
          title={openAll.open ? "Collapse every tool call and thinking line in this run" : "Expand every tool call and thinking line in this run"}
        >
          {openAll.open ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {row.open && (
        <div className="fold-body">
          {row.items.map((item, k) => {
            const vi = row.firstVisible + k;
            const isCurrent = current?.turnIndex === vi;
            return (
              <TurnRow
                key={item.turn.uuid}
                item={item}
                query={query}
                currentBlock={isCurrent && current ? current.blockIndex : -1}
                currentOcc={isCurrent && current ? current.occ : -1}
                openAll={openAll}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
