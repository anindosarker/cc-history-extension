import type { WebviewToHost } from "@shared/protocol";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi | undefined =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

export function post(msg: WebviewToHost): void {
  api?.postMessage(msg);
}
