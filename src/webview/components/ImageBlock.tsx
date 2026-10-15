import { memo, useState } from "react";
import type { Block } from "@shared/types";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  block: Extract<Block, { type: "image" }>;
}

/** A pasted image: a thumbnail that toggles to full size in place, or a note when the host left it out. */
export const ImageBlock = memo(function ImageBlock({ block }: Props) {
  const [full, setFull] = useState(false);
  if ("omitted" in block) {
    return (
      <span className="image-omitted text-[11px] italic text-muted-foreground select-none">
        {`Image omitted (${formatBytes(block.bytes)})`}
      </span>
    );
  }
  return (
    <img
      src={`data:${block.mediaType};base64,${block.data}`}
      alt="Pasted image"
      className={cn(
        // self-start keeps the flex column from stretching the image to the bubble width.
        "image-block block self-start max-w-full h-auto object-contain rounded-[8px] border",
        full ? "cursor-zoom-out" : "max-h-[240px] w-auto cursor-zoom-in",
      )}
      title={full ? "Click to shrink" : "Click to show full size"}
      onClick={() => setFull((v) => !v)}
    />
  );
});
