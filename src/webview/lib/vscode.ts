import type { WebviewToHost } from "@shared/protocol";
import type { UsageWebviewToHost } from "@shared/usage";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi | undefined =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

export function post(msg: WebviewToHost | UsageWebviewToHost): void {
  api?.postMessage(msg);
}
