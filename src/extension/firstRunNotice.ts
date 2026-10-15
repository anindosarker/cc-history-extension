/**
 * Decides whether the one-time Keychain notice should be shown. Pure so it can be unit tested;
 * the caller marks the notice as shown before displaying it.
 */
export const FIRST_RUN_NOTICE_KEY = "ccHistory.firstRunNoticeShown";

export const FIRST_RUN_NOTICE_TEXT =
  "Claude Code History reads your Claude Code login from the Keychain to show usage limits. You can turn this off.";

export const FIRST_RUN_KEEP = "Keep";
export const FIRST_RUN_DISABLE = "Disable usage widget";

export interface FirstRunState {
  /** The globalState flag; true once the notice has been shown on this machine. */
  alreadyShown: boolean;
  /** Current value of ccHistory.usage.enabled. */
  usageEnabled: boolean;
}

export function shouldShowFirstRunNotice(state: FirstRunState): boolean {
  return !state.alreadyShown && state.usageEnabled;
}
