import * as vscode from "vscode";
import {
  FIRST_RUN_DISABLE,
  FIRST_RUN_KEEP,
  FIRST_RUN_NOTICE_KEY,
  FIRST_RUN_NOTICE_TEXT,
  shouldShowFirstRunNotice,
} from "./firstRunNotice";

/** Shows the Keychain notice once per machine. The flag is set before the message so a crash or reload cannot repeat it. */
export async function maybeShowFirstRunNotice(context: vscode.ExtensionContext): Promise<void> {
  const state = {
    alreadyShown: context.globalState.get<boolean>(FIRST_RUN_NOTICE_KEY) === true,
    usageEnabled: vscode.workspace.getConfiguration("ccHistory.usage").get<boolean>("enabled") ?? true,
  };
  if (!shouldShowFirstRunNotice(state)) return;
  await context.globalState.update(FIRST_RUN_NOTICE_KEY, true);
  const choice = await vscode.window.showInformationMessage(FIRST_RUN_NOTICE_TEXT, FIRST_RUN_KEEP, FIRST_RUN_DISABLE);
  if (choice === FIRST_RUN_DISABLE) {
    await vscode.workspace
      .getConfiguration("ccHistory.usage")
      .update("enabled", false, vscode.ConfigurationTarget.Global);
  }
}
