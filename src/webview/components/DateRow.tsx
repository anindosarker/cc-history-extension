import { memo } from "react";
import type { DateRow as DateRowModel } from "@/lib/search";
import { formatFullDateTime } from "@/lib/format";

/** A thin centered day label between messages from different days. */
export const DateRow = memo(function DateRow({ row }: { row: DateRowModel }) {
  return (
    <div
      className="date-row flex items-center gap-3 px-4 py-[6px] text-[11px] leading-none text-muted-foreground select-none"
      title={formatFullDateTime(row.timestamp)}
      aria-hidden="true"
    >
      <span className="fold-rule h-px flex-1" />
      <span className="shrink-0">{row.label}</span>
      <span className="fold-rule h-px flex-1" />
    </div>
  );
});
