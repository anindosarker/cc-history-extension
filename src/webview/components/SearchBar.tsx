import { forwardRef } from "react";
import { Bot, Brain, ChevronDown, ChevronUp, Search, User, Users, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Filters, RoleFilter } from "@/lib/search";
import { cn } from "@/lib/utils";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  current: number;
  onNext: () => void;
  onPrev: () => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, onQueryChange, matchCount, current, onNext, onPrev, filters, onFiltersChange },
  ref,
) {
  const roles: { value: RoleFilter; label: string; icon: React.ReactNode }[] = [
    { value: "all", label: "All roles", icon: <Users /> },
    { value: "user", label: "User only", icon: <User /> },
    { value: "assistant", label: "Assistant only", icon: <Bot /> },
  ];
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background min-w-0 shrink-0">
      <div className="relative flex-1 min-w-[4.5rem] max-w-[520px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={ref}
          value={query}
          placeholder="Search messages (Enter: next, Shift+Enter: previous, Esc: clear)"
          className="pl-7 pr-7 min-w-0"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onQueryChange("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {query && (
        <span className="text-muted-foreground tabular-nums whitespace-nowrap min-w-[4.5em] text-center">
          {matchCount === 0 ? "0 results" : `${current + 1} / ${matchCount}`}
        </span>
      )}
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onPrev} disabled={matchCount === 0} aria-label="Previous match">
        <ChevronUp />
      </Button>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onNext} disabled={matchCount === 0} aria-label="Next match">
        <ChevronDown />
      </Button>
      <div className="ml-auto flex items-center gap-1 shrink-0">
        <Toggle
          active={filters.showThinking}
          label={filters.showThinking ? "Hide thinking" : "Show thinking"}
          onClick={() => onFiltersChange({ ...filters, showThinking: !filters.showThinking })}
        >
          <Brain />
        </Toggle>
        <Toggle
          active={filters.showTools}
          label={filters.showTools ? "Hide tool calls" : "Show tool calls"}
          onClick={() => onFiltersChange({ ...filters, showTools: !filters.showTools })}
        >
          <Wrench />
        </Toggle>
        <div className="flex items-center gap-0.5 ml-1" role="group" aria-label="Role filter">
          {roles.map((r) => (
            <Tooltip key={r.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "h-6 w-7 inline-flex items-center justify-center rounded-md cursor-pointer [&_svg]:size-3.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                    filters.role === r.value && "bg-accent text-foreground",
                  )}
                  onClick={() => onFiltersChange({ ...filters, role: r.value })}
                  aria-label={r.label}
                >
                  {r.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent>{r.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
});

function Toggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className={cn(active ? "bg-accent text-foreground" : "text-muted-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
