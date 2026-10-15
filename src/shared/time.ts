/**
 * Locale-aware date and time formatting shared by the extension host and the webview.
 * Every rendered timestamp goes through one of these so the host tooltips, the status bar,
 * the usage panel and the session viewer all read the same way.
 */

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

/** Clock options for the locale: "9:05 PM" on a 12 hour clock, "09:05" (padded) on a 24 hour one. */
function clockOptions(locale: string | undefined, seconds: boolean): Intl.DateTimeFormatOptions {
  const hour12 = intl(locale, { hour: "numeric" }).resolvedOptions().hour12 ?? true;
  return { hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) };
}

/** Time only, hour and minute, 12 or 24 hour clock per the locale: "11:32 PM" in en-US, "23:32" in de-DE. */
export function formatClock(ts: number, { locale }: DateFormatOptions = {}): string {
  return intl(locale, clockOptions(locale, false)).format(new Date(ts));
}

/** "Sep 29" within the current year, "Sep 29, 2026" outside it. */
export function formatHumanDate(ts: number, { now = Date.now(), locale }: DateFormatOptions = {}): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return intl(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

/** "Sep 29 · 10:51 PM" in the user's locale; outside the current year "Sep 29, 2026 · 10:51 PM". */
export function formatHumanDateTime(ts: number, opts: DateFormatOptions = {}): string {
  return `${formatHumanDate(ts, opts)} · ${formatClock(ts, opts)}`;
}

/** "Tue, Sep 29, 2026 · 10:51:07 PM" in the user's locale, for every tooltip. */
export function formatFullDateTime(ts: number, { locale }: DateFormatOptions = {}): string {
  const d = new Date(ts);
  const date = intl(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = intl(locale, clockOptions(locale, true)).format(d);
  return `${date} · ${time}`;
}

/** "Tue, Sep 29", for the date divider between days. */
export function formatDayLabel(ts: number, { locale }: DateFormatOptions = {}): string {
  return intl(locale, { weekday: "short", month: "short", day: "numeric" }).format(new Date(ts));
}

/** "Tue", for reset times beyond the current day. */
export function formatWeekday(ts: number, { locale }: DateFormatOptions = {}): string {
  return intl(locale, { weekday: "short" }).format(new Date(ts));
}

/** Local calendar day, used to decide where a date divider goes. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
