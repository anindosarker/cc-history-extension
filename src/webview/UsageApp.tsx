import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  DEFAULT_THRESHOLDS,
  ERROR_REASON_TEXT,
  barLevel,
  elapsedFraction,
  formatAgo,
  formatResetAt,
  paceProjection,
  pct,
  type UsageHostToWebview,
  type BarLevel,
  type UsageLimitView,
  type UsageThresholds,
  type UsageView,
} from "@shared/usage";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/vscode";
import { cn } from "@/lib/utils";

const CLOCK_TICK_MS = 10_000;

/** Rate-limit usage panel: a few bars with pace markers and a summary of this week's sessions. */
export function UsageApp() {
  const [view, setView] = useState<UsageView | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onMessage = (e: MessageEvent<UsageHostToWebview>) => {
      if (e.data?.type === "usageSnapshot") {
        setView(e.data.view);
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

  const refresh = () => post({ type: "usageRefresh" });

  if (!view) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading usage…
      </div>
    );
  }

  const hasReading = view.limits.length > 0;
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-[640px] px-5 py-4 text-[13px] leading-[1.55]">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[15px] font-semibold leading-tight">Usage</h1>
          {view.plan && <span className="text-muted-foreground truncate">{view.plan}</span>}
          <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
            {view.fetchedAt !== undefined ? `Updated ${formatAgo(now - view.fetchedAt)}` : "Not fetched yet"}
          </span>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={view.refreshing} aria-label="Refresh usage">
            <RefreshCw className={cn(view.refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {view.error && (
          <div className="mt-4 rounded-[6px] border border-destructive/50 px-3 py-2">
            <div className="text-destructive">{ERROR_REASON_TEXT[view.error.reason]}</div>
            {(view.error.reason === "http" || view.error.reason === "network") && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{view.error.message}</div>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={refresh} disabled={view.refreshing}>
                Retry
              </Button>
              <span className="text-[11px] text-muted-foreground">Last attempt {formatAgo(now - view.error.at)}</span>
            </div>
          </div>
        )}

        {hasReading ? (
          <div className="mt-5 flex flex-col gap-4">
            {view.limits.map((l) => (
              <LimitRow key={l.label} limit={l} now={now} thresholds={view.thresholds ?? DEFAULT_THRESHOLDS} />
            ))}
          </div>
        ) : (
          !view.error && (
            <div className="mt-5 text-muted-foreground">
              {view.refreshing ? "Fetching usage…" : "No usage limits reported for this account."}
            </div>
          )
        )}

        <h2 className="mt-7 text-[14px] font-semibold">This week</h2>
        <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
          <Stat value={view.week.sessions} label={view.week.sessions === 1 ? "session" : "sessions"} />
          <Stat value={view.week.messages} label={view.week.messages === 1 ? "message" : "messages"} />
        </div>
        {view.week.topProjects.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-muted-foreground">
            {view.week.topProjects.map((p) => (
              <li key={p.name} className="flex items-baseline gap-2 min-w-0">
                <span className="text-foreground truncate">{p.name}</span>
                <span className="tabular-nums text-[11px] whitespace-nowrap">
                  {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[18px] font-semibold tabular-nums leading-none">{value.toLocaleString()}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** The same thresholds and colour source as the status bar, so the two never disagree. */
function barColor(level: BarLevel): string {
  if (level === "error") return "var(--vscode-statusBarItem-errorBackground, var(--vscode-charts-red))";
  if (level === "warning") return "var(--vscode-statusBarItem-warningBackground, var(--vscode-charts-yellow))";
  return "currentColor";
}

function LimitRow({ limit, now, thresholds }: { limit: UsageLimitView; now: number; thresholds: UsageThresholds }) {
  const elapsed = limit.resetsAt !== undefined ? elapsedFraction(limit.resetsAt, limit.windowMs, now) : undefined;
  const projected = elapsed !== undefined ? paceProjection(limit.pct, elapsed) : undefined;
  const fill = Math.min(100, Math.max(0, limit.pct));
  return (
    <div data-limit={limit.label}>
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate">{limit.label}</span>
        <span className="tabular-nums font-medium">{pct(limit.pct)}</span>
      </div>
      <div
        className="relative mt-1.5 h-1 w-full rounded-full"
        style={{ background: "color-mix(in srgb, currentColor 14%, transparent)" }}
        role="progressbar"
        aria-valuenow={Math.round(limit.pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={limit.label}
      >
        <div className="h-full rounded-full" style={{ width: `${fill}%`, background: barColor(barLevel(limit, thresholds)) }} />
        {elapsed !== undefined && (
          <div
            className="absolute top-[-3px] h-[10px] w-px bg-foreground/60"
            style={{ left: `${elapsed * 100}%` }}
            title="Even pace through the window"
            data-pace-marker
          />
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {limit.resetsAt !== undefined ? `resets ${formatResetAt(limit.resetsAt, now)}` : "no reset time reported"}
        {projected !== undefined && ` · on pace for ~${Math.round(projected)}% at reset`}
      </div>
    </div>
  );
}
