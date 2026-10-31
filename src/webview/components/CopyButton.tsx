import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/vscode";
import { cn } from "@/lib/utils";

const COPIED_MS = 1500;

/** Hover-only icon button that copies a message's markdown source, then shows a check for a moment. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const label = copied ? "Copied" : "Copy message";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("copy-btn h-5 w-5 text-muted-foreground select-none", className)}
      data-copied={copied || undefined}
      aria-label={label}
      title={label}
      onClick={() => {
        post({ type: "copyText", text });
        setCopied(true);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
