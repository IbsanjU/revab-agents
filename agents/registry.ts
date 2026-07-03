import { execCommand } from "../utils/exec.js";

/**
 * Task type registry: maps orchestrator task types to handlers.
 * Add new capabilities here — keep handlers generic and parameterized.
 * Handlers run whitelisted npm scripts only (no arbitrary shell from payloads).
 */
export interface TaskHandler {
  description: string;
  run(payload: Record<string, unknown>): Promise<unknown>;
}

const TAG_PATTERN = /^[@\w\s()|&-]+$/; // cucumber tag expressions only

export const handlers: Record<string, TaskHandler> = {
  "run-bdd": {
    description: "Run the Cucumber/Playwright BDD suite. Payload: { tags?: '@smoke' }",
    async run(payload) {
      const args = ["run", "test:bdd"];
      const tags = typeof payload.tags === "string" ? payload.tags : undefined;
      if (tags) {
        if (!TAG_PATTERN.test(tags)) throw new Error(`Invalid tag expression: ${tags}`);
        args.push("--", "--tags", `"${tags}"`);
      }
      const result = await execCommand("npm", args);
      return { exitCode: result.code, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
    },
  },
  "generate-report": {
    description: "Generate the Allure report from the latest results.",
    async run() {
      const result = await execCommand("npm", ["run", "report:generate"]);
      return { exitCode: result.code, stdout: result.stdout.slice(-2000) };
    },
  },
  typecheck: {
    description: "Typecheck the whole repo.",
    async run() {
      const result = await execCommand("npm", ["run", "typecheck"]);
      return { exitCode: result.code, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
    },
  },
  "import-agents": {
    description: "Import agents/scripts from another repo. Payload: { source: 'C:/path/to/repo', dryRun?: true }",
    async run(payload) {
      const source = typeof payload.source === "string" ? payload.source : undefined;
      if (!source) throw new Error("payload.source (path to source repo) is required");
      const args = ["run", "import:agents", "--", source];
      if (payload.dryRun) args.push("--dry-run");
      const result = await execCommand("npm", args);
      return { exitCode: result.code, stdout: result.stdout.slice(-4000), stderr: result.stderr.slice(-4000) };
    },
  },
};

export function listTaskTypes(): Array<{ type: string; description: string }> {
  return Object.entries(handlers).map(([type, h]) => ({ type, description: h.description }));
}
