import { memo } from "react";
import type { VisibleTurn } from "@/lib/search";
import { countOccurrences, blockText } from "@/lib/search";
import { formatClock } from "@/lib/format";
import { AgentTurn, SystemTurn } from "./InjectedTurn";
import { TextBlock } from "./TextBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseBlock } from "./ToolUseBlock";

interface Props {
  item: VisibleTurn;
  query: string;
  /** Block index of the current match inside this turn, or -1. */
  currentBlock: number;
  currentOcc: number;
}

export const TurnRow = memo(function TurnRow({ item, query, currentBlock, currentOcc }: Props) {
  const { turn, blocks } = item;
  const isUser = turn.role === "user";
  const time = turn.timestamp ? formatClock(turn.timestamp) : "";
  // Injected turns carry a single text block, so the current occurrence lives in block 0.
  const injectedCurrent = currentBlock === 0 ? currentOcc : -1;
  if (turn.kind === "agent") return <AgentTurn item={item} query={query} current={injectedCurrent} time={time} />;
  if (turn.kind === "system") return <SystemTurn item={item} query={query} current={injectedCurrent} time={time} />;
  const body = (
    <div className="flex flex-col gap-2 min-w-0">
      {blocks.map((b, bi) => {
        const cur = bi === currentBlock ? currentOcc : -1;
        const hasMatch = query !== "" && countOccurrences(blockText(b), query) > 0;
        if (b.type === "text") {
          return <TextBlock key={bi} text={b.text} query={query} current={cur} hasMatch={hasMatch} />;
        }
        if (b.type === "thinking") {
          return <ThinkingBlock key={bi} text={b.thinking} query={query} current={cur} hasMatch={hasMatch} />;
        }
        return <ToolUseBlock key={b.id || bi} block={b} query={query} current={cur} />;
      })}
      {blocks.length === 0 && <span className="text-muted-foreground italic">(empty)</span>}
    </div>
  );

  if (isUser) {
    return (
      <div className="group chat-turn px-4 py-[10px] flex flex-col items-end" data-turn-index={item.index}>
        <div className="chat-bubble max-w-[85%] min-w-0 rounded-[12px] px-[14px] py-[10px]">{body}</div>
        {time && (
          <div className="mt-1 text-[11px] leading-none text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 select-none">
            {time}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-turn px-4 py-[10px]" data-turn-index={item.index}>
      <div className="mb-1.5 text-[11px] leading-none text-muted-foreground select-none">
        {["Claude", time].filter(Boolean).join(" · ")}
      </div>
      {body}
    </div>
  );
});
