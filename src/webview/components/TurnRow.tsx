import { memo } from "react";
import type { OpenAll, VisibleTurn } from "@/lib/search";
import { countOccurrences, blockText } from "@/lib/search";
import { formatClock, formatFullDateTime } from "@/lib/format";
import { AgentTurn, SystemTurn } from "./InjectedTurn";
import { ImageBlock } from "./ImageBlock";
import { TextBlock } from "./TextBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseBlock } from "./ToolUseBlock";

interface Props {
  item: VisibleTurn;
  query: string;
  /** Block index of the current match inside this turn, or -1. */
  currentBlock: number;
  currentOcc: number;
  /** Set by a fold's "Expand all" / "Collapse all"; every tool and thinking line follows it. */
  openAll?: OpenAll;
}

export const TurnRow = memo(function TurnRow({ item, query, currentBlock, currentOcc, openAll }: Props) {
  const { turn, blocks } = item;
  const isUser = turn.role === "user";
  const time = turn.timestamp ? formatClock(turn.timestamp) : "";
  const fullTime = turn.timestamp ? formatFullDateTime(turn.timestamp) : undefined;
  // Injected turns carry a single text block, so the current occurrence lives in block 0.
  const injectedCurrent = currentBlock === 0 ? currentOcc : -1;
  if (turn.kind === "agent") return <AgentTurn item={item} query={query} current={injectedCurrent} time={time} />;
  if (turn.kind === "system") return <SystemTurn item={item} query={query} current={injectedCurrent} time={time} />;
  const body = (
    <div className="turn-blocks tier-1 flex flex-col gap-[14px] min-w-0">
      {blocks.map((b, bi) => {
        const cur = bi === currentBlock ? currentOcc : -1;
        const hasMatch = query !== "" && countOccurrences(blockText(b), query) > 0;
        if (b.type === "text") {
          return <TextBlock key={bi} text={b.text} query={query} current={cur} hasMatch={hasMatch} />;
        }
        if (b.type === "thinking") {
          return (
            <ThinkingBlock key={bi} text={b.thinking} query={query} current={cur} hasMatch={hasMatch} openAll={openAll} />
          );
        }
        if (b.type === "image") return <ImageBlock key={bi} block={b} />;
        return <ToolUseBlock key={b.id || bi} block={b} query={query} current={cur} openAll={openAll} />;
      })}
      {blocks.length === 0 && <span className="text-muted-foreground italic">(empty)</span>}
    </div>
  );

  if (isUser) {
    return (
      <div className="chat-turn py-[18px]" data-turn-index={item.index}>
        <div className="chat-content flex flex-col items-end">
          <div className="chat-bubble max-w-[85%] min-w-0 rounded-[12px] px-[18px] py-[14px]">
            {body}
            {time && (
              <div
                className="mt-[6px] text-right text-[11px] leading-none text-muted-foreground select-none"
                title={fullTime}
              >
                {time}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-turn py-[18px]" data-turn-index={item.index}>
      <div className="chat-content relative">
        {time && (
          <span
            className="turn-time absolute top-0 text-[11px] leading-none text-muted-foreground select-none"
            title={fullTime}
            aria-hidden="true"
          >
            {time}
          </span>
        )}
        {body}
      </div>
    </div>
  );
});
