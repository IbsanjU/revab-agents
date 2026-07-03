/** Minimal timestamped logger shared by orchestrator components. */
export function log(scope: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}

export function logError(scope: string, message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.stack ?? err.message : err ? String(err) : "";
  console.error(`[${new Date().toISOString()}] [${scope}] ${message}${detail ? `\n${detail}` : ""}`);
}
