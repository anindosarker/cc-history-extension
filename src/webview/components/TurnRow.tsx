import { memo } from "react";
import { Bot, User } from "lucide-react";
import type { VisibleTurn } from "@/lib/search";
import { countOccurrences, blockText } from "@/lib/search";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  return (
    <div
      className={cn(
        "border-l-[3px] pl-3 pr-3 py-2.5 my-1.5 mx-3 rounded-r-md",
        isUser ? "border-user bg-user/5" : "border-assistant bg-assistant/5",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1 text-[0.9em] text-muted-foreground select-none">
        {isUser ? <User className="size-3.5 text-user" /> : <Bot className="size-3.5 text-assistant" />}
        <span className={cn("font-semibold", isUser ? "text-user" : "text-assistant")}>
          {isUser ? "User" : "Assistant"}
        </span>
        <span>{turn.timestamp ? formatTime(turn.timestamp) : ""}</span>
        <span className="ml-auto opacity-60">#{item.index + 1}</span>
      </div>
      <div className="flex flex-col gap-1.5">
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
    </div>
  );
});
