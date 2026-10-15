import { forwardRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export const DEFAULT_FILTERS: Filters = { role: "all", showThinking: true, showTools: true };

/** True when any filter differs from the default, which puts a dot on the Filters icon. */
export function filtersActive(f: Filters): boolean {
  return f.role !== DEFAULT_FILTERS.role || f.showThinking !== DEFAULT_FILTERS.showThinking || f.showTools !== DEFAULT_FILTERS.showTools;
}

const ROLES: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
];

/** Search input with the match counter and prev/next inside its right end, plus a Filters popover. */
export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, onQueryChange, matchCount, current, onNext, onPrev, filters, onFiltersChange },
  ref,
) {
  const active = filtersActive(filters);
  const [open, setOpen] = useState(false);
  return (
    <div className="search-bar flex flex-1 items-center gap-1.5 min-w-0">
      <div className="search-field relative flex-1 min-w-[4rem]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={ref}
          value={query}
          placeholder="Search messages"
          aria-label="Search messages (Enter: next, Shift+Enter: previous, Esc: clear)"
          className={cn("search-input pl-7 min-w-0", query ? "pr-[7.5rem]" : "pr-2")}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              onQueryChange("");
            }
          }}
        />
        {query && (
          <div className="search-tools absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <span className="search-count text-[11px] text-muted-foreground tabular-nums whitespace-nowrap select-none px-1">
              {matchCount === 0 ? "0 results" : `${current + 1} / ${matchCount}`}
            </span>
            <IconButton label="Previous match" onClick={onPrev} disabled={matchCount === 0}>
              <ChevronUp />
            </IconButton>
            <IconButton label="Next match" onClick={onNext} disabled={matchCount === 0}>
              <ChevronDown />
            </IconButton>
            <IconButton label="Clear search" onClick={() => onQueryChange("")}>
              <X />
            </IconButton>
          </div>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="filters-button relative shrink-0 h-7 w-7 text-muted-foreground data-[open=true]:bg-accent data-[open=true]:text-foreground"
                aria-label="Filters"
                data-active={active ? "true" : "false"}
                // The tooltip trigger overwrites data-state, so the open look keys off this attribute.
                data-open={open ? "true" : "false"}
              >
                <SlidersHorizontal />
                {active && (
                  <span
                    className="filters-dot absolute right-1 top-1 block size-1.5 rounded-full bg-link"
                    aria-hidden="true"
                  />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Filters</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-56 p-2 text-[12px]">
          <div className="flex flex-col gap-1">
            <Check
              label="Show thinking"
              checked={filters.showThinking}
              onChange={(v) => onFiltersChange({ ...filters, showThinking: v })}
            />
            <Check
              label="Show tool calls"
              checked={filters.showTools}
              onChange={(v) => onFiltersChange({ ...filters, showTools: v })}
            />
            <div className="mt-1 mb-0.5 text-[11px] text-muted-foreground select-none">Role</div>
            <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Role filter">
              {ROLES.map((r) => (
                <label key={r.value} className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent cursor-pointer">
                  <input
                    type="radio"
                    name="role-filter"
                    value={r.value}
                    checked={filters.role === r.value}
                    onChange={() => onFiltersChange({ ...filters, role: r.value })}
                    className="accent-[color:var(--link)]"
                  />
                  {r.label}
                </label>
              ))}
            </div>
            {active && (
              <Button
                variant="link"
                size="sm"
                className="self-start px-1 mt-1"
                onClick={() => onFiltersChange(DEFAULT_FILTERS)}
              >
                Reset filters
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[color:var(--link)]" />
      {label}
    </label>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
