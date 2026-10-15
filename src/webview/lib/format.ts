export interface DateFormatOptions {
  /** Reference time deciding whether the year is shown; defaults to now. */
  now?: number;
  /** BCP 47 tag; defaults to the user's locale. An invalid tag falls back to the default. */
  locale?: string;
}

function intl(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, opts);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts);
  }
}

/** "Sep 29, 2026 · 10:51 PM" in the user's locale; within the current year "Sep 29 · 10:51 PM". */
export function formatHumanDateTime(ts: number, { now = Date.now(), locale }: DateFormatOptions = {}): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = intl(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
  const time = intl(locale, { hour: "numeric", minute: "2-digit" }).format(d);
  return `${date} · ${time}`;
}

/** Kept for the ISO-like form some surfaces still want: "2026-09-29 22:51". */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue, Sep 29", for the date divider between days. */
export function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Tue, Sep 29, 2026 · 2:53:07 PM" in the user's locale, for the timestamp tooltips. */
export function formatFullDateTime(ts: number, { locale }: DateFormatOptions = {}): string {
  const d = new Date(ts);
  const date = intl(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = intl(locale, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(d);
  return `${date} · ${time}`;
}

/** Local calendar day, used to decide where a date divider goes. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "4.2 MB", "320 kB", "900 B" */
export function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} kB`;
  return `${n} B`;
}

/** Hours and minutes only, for the quiet per-turn meta line. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return "<1m";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}

/** "2.2M", "15.3k", "980" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
