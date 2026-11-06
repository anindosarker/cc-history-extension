import { useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, RefreshCw } from "lucide-react";
import {
  DEFAULT_THRESHOLDS,
  ERROR_REASON_TEXT,
  accountLabel,
  barLevel,
  elapsedFraction,
  formatAgo,
  formatResetAt,
  heldText,
  paceMarkerText,
  paceProjection,
  pct,
  readingExpired,
  retryUntilText,
  type UsageHostToWebview,
  type BarLevel,
  type UsageLimitView,
  type UsageThresholds,
  type UsageView,
} from "@shared/usage";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { post } from "@/lib/vscode";
import { cn } from "@/lib/utils";

const CLOCK_TICK_MS = 10_000;

/** Rate-limit usage panel: a few bars with pace markers, coloured by level. */
export function UsageApp() {
  const [view, setView] = useState<UsageView | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  // Spinner from the click until the host reports the refresh is over.
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent<UsageHostToWebview>) => {
      if (e.data?.type === "usageSnapshot") {
        setView(e.data.view);
        if (!e.data.view.refreshing) setPending(false);
        setNow(Date.now());
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "usageRequest" });
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(tick);
    };
  }, []);

  const refresh = () => {
    setPending(true);
    post({ type: "usageRefresh" });
  };
  const switchAccount = () => post({ type: "switchAccount" });
  const retryText = view ? retryUntilText(view.retryUntil, now) : undefined;
  const spinning = pending || (view?.refreshing ?? false);
  const refreshDisabled = view ? spinning || retryText !== undefined : true;

  if (!view) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading usage…
      </div>
    );
  }

  // The panel ticks between pushes, so drop a reading here too once it expires.
  const expired = view.fetchedAt !== undefined && readingExpired(view.fetchedAt, view.limits, now);
  const limits = expired ? [] : view.limits;
  const fetchedAt = expired ? undefined : view.fetchedAt;
  const hasReading = limits.length > 0;
  const held = heldText(view.error, fetchedAt, now);
  const account = accountLabel(view.account);
  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-[640px] px-5 py-4 text-[13px] leading-[1.55]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <h1 className="mr-auto text-[15px] font-semibold leading-tight">Usage</h1>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {fetchedAt !== undefined ? `Updated ${formatAgo(now - fetchedAt)}` : "Not fetched yet"}
            </span>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshDisabled} aria-label="Refresh usage" title={retryText}>
              <RefreshCw className={cn(spinning && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={switchAccount} aria-label="Switch account" title="Sign in to a different Claude account">
              <ArrowLeftRight />
              Switch account
            </Button>
          </div>
          {(account || view.plan) && (
            <div className="mt-0.5 text-[12px] text-muted-foreground break-words" data-account>
              {[account, view.plan].filter(Boolean).join(" · ")}
            </div>
          )}

          {retryText && <div className="mt-3 text-[11px] text-muted-foreground">{retryText}</div>}

          {held ? (
            <div className="mt-4 rounded-[6px] border border-border px-3 py-2 text-muted-foreground" data-held>
              {held}
              {view.error && view.error.status !== 429 && (
                <div className="mt-0.5 text-[11px]">{view.error.message}</div>
              )}
            </div>
          ) : (
            view.error && (
              <div className="mt-4 rounded-[6px] border border-destructive/50 px-3 py-2">
                <div className="text-destructive">{ERROR_REASON_TEXT[view.error.reason]}</div>
                {(view.error.reason === "http" || view.error.reason === "network") && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{view.error.message}</div>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refresh} disabled={refreshDisabled} title={retryText}>
                    {spinning && <Loader2 className="animate-spin" />}
                    Retry
                  </Button>
                  {(view.error.reason === "no-credentials" || view.error.reason === "token-expired") && (
                    <Button variant="outline" size="sm" onClick={switchAccount}>
                      <ArrowLeftRight />
                      Switch account
                    </Button>
                  )}
                  <span className="text-[11px] text-muted-foreground">Last attempt {formatAgo(now - view.error.at)}</span>
                </div>
              </div>
            )
          )}

          {hasReading ? (
            <div className="mt-5 flex flex-col gap-4">
              {limits.map((l) => (
                <LimitRow key={l.label} limit={l} now={now} thresholds={view.thresholds ?? DEFAULT_THRESHOLDS} />
              ))}
            </div>
          ) : (
            !view.error && (
              <div className="mt-5 text-muted-foreground">
                {spinning || expired ? "Fetching usage…" : "No usage limits reported for this account."}
              </div>
            )
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * The same thresholds and colour source as the status bar, so the two never disagree. Below the
 * warning level the bar is the theme's chart green, so every bar carries a colour.
 */
function barColor(level: BarLevel): string {
  if (level === "error") return "var(--vscode-statusBarItem-errorBackground, var(--vscode-charts-red))";
  if (level === "warning") return "var(--vscode-statusBarItem-warningBackground, var(--vscode-charts-yellow))";
  return "var(--vscode-charts-green, #388a34)";
}

function LimitRow({ limit, now, thresholds }: { limit: UsageLimitView; now: number; thresholds: UsageThresholds }) {
  const elapsed = limit.resetsAt !== undefined ? elapsedFraction(limit.resetsAt, limit.windowMs, now) : undefined;
  const projected = elapsed !== undefined ? paceProjection(limit.pct, elapsed) : undefined;
  const fill = Math.min(100, Math.max(0, limit.pct));
  const color = barColor(barLevel(limit, thresholds));
  const bar = (
    <div
      className="relative mt-1.5 h-1 w-full rounded-full"
      // The level colour tints the whole track, so it shows even at 0%; the used part is solid.
      style={{ background: `color-mix(in srgb, ${color} 20%, transparent)` }}
      role="progressbar"
      aria-valuenow={Math.round(limit.pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={limit.label}
    >
      <div className="h-full rounded-full" style={{ width: `${fill}%`, background: color }} />
      {elapsed !== undefined && (
        <div className="absolute top-[-6px] h-4 w-3 -translate-x-1/2 flex justify-center" style={{ left: `${elapsed * 100}%` }} data-pace-marker>
          <div className="mt-[3px] h-[10px] w-px bg-foreground/70" />
        </div>
      )}
    </div>
  );
  return (
    <div data-limit={limit.label}>
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate">{limit.label}</span>
        <span className="tabular-nums font-medium">{pct(limit.pct)}</span>
      </div>
      {elapsed !== undefined ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="py-1 -my-1 cursor-default">{bar}</div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[320px] text-[12px]">{paceMarkerText(elapsed)}</TooltipContent>
        </Tooltip>
      ) : (
        bar
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">
        {limit.resetsAt !== undefined ? `resets ${formatResetAt(limit.resetsAt, now)}` : "no reset time reported"}
        {projected !== undefined && ` · on pace for ~${Math.round(projected)}% at reset`}
      </div>
    </div>
  );
}
