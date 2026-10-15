import type { OpenAt } from "@shared/openAt";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  value: OpenAt;
  onChange: (value: OpenAt) => void;
}

const OPTIONS: { value: OpenAt; label: string; hint: string }[] = [
  { value: "oldest", label: "Old", hint: "Open sessions at the first message" },
  { value: "newest", label: "New", hint: "Open sessions at the latest message" },
];

/** Segmented Old | New switch. The choice is persisted by the host in ccHistory.openAt. */
export function OpenAtToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Open sessions at"
      className="inline-flex h-7 items-center rounded-md border border-border overflow-hidden"
    >
      {OPTIONS.map((o) => (
        <Tooltip key={o.value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={value === o.value}
              className={cn(
                "h-full px-2.5 cursor-pointer hover:bg-accent transition-colors",
                value === o.value && "bg-primary text-primary-foreground hover:bg-primary",
              )}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          </TooltipTrigger>
          <TooltipContent>{o.hint}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
