import { memo } from "react";
import type { DateRow as DateRowModel } from "@/lib/search";
import { formatFullDateTime } from "@/lib/format";

/** A thin centered day label between messages from different days. */
export const DateRow = memo(function DateRow({ row }: { row: DateRowModel }) {
  return (
    <div className="date-row chat-turn py-[2px]" title={formatFullDateTime(row.timestamp)} aria-hidden="true">
      <div className="chat-content tier-2 flex items-center gap-3 leading-none select-none">
        <span className="fold-rule h-px flex-1" />
        <span className="tier-3 shrink-0 text-[11px]">{row.label}</span>
        <span className="fold-rule h-px flex-1" />
      </div>
    </div>
  );
});
