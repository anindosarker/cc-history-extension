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
  narrow?: boolean;
}

/** One-line "Worked for 4m" divider; the folded turns unfold in place below it. */
export const FoldRow = memo(function FoldRow({ row, query, current, onToggle, narrow }: Props) {
  // Last "Expand all" / "Collapse all" request; seq 0 means nobody asked yet.
  const [openAll, setOpenAll] = useState<OpenAll>({ open: false, seq: 0 });
  const calls = `${row.toolCalls} tool call${row.toolCalls === 1 ? "" : "s"}`;
  const toggleAll = () => {
    const open = !openAll.open;
    setOpenAll({ open, seq: openAll.seq + 1 });
    if (open && !row.open) onToggle(row.key, true);
  };
  return (
    <div className="chat-turn py-[6px]" data-fold={row.key}>
      <div className="chat-content">
        <div
          className="fold-head tier-2 flex items-center gap-3 leading-none select-none"
          data-open={row.open ? "true" : "false"}
        >
          <button
            type="button"
            className="fold-line tier-hover flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
            aria-expanded={row.open}
            onClick={() => onToggle(row.key, !row.open)}
          >
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", row.open && "rotate-90")} />
            <span className="shrink-0">{`Worked for ${formatWorkDuration(row.durationMs)}`}</span>
            <span className="fold-rule h-px flex-1" aria-hidden="true" />
          </button>
          <span className="tier-3 flex shrink-0 items-center gap-3 text-[11px]">
            {row.hasMatch && !row.open && <span className="shrink-0">(match)</span>}
            <span className="shrink-0">{calls}</span>
            <button
              type="button"
              className="fold-all shrink-0 cursor-pointer hover:underline"
              onClick={toggleAll}
              title={
                openAll.open
                  ? "Collapse every tool call and thinking line in this run"
                  : "Expand every tool call and thinking line in this run"
              }
            >
              {openAll.open ? "Collapse all" : "Expand all"}
            </button>
          </span>
        </div>
        {row.open && (
          <div className="fold-body pt-[6px]">
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
                  narrow={narrow}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
