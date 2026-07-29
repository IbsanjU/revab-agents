#!/usr/bin/env node
/**
 * `revab` — the operator CLI.
 *
 * Getting a teammate productive used to mean: clone, read the README, copy .env,
 * guess which vars matter, start 11 servers, and discover misconfiguration as an
 * opaque HTTP error inside a tool call. These three commands replace that:
 *
 *   revab init      scaffold .env, register the gateway in .vscode/mcp.json, seed a project
 *   revab doctor    check env/auth/ports/gateway before anything is blamed on the agents
 *   revab start     run the gateway (all tools, one process, MCP + REST)
 *
 * Deliberately dependency-free argument handling, matching the other scripts here.
 */
import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";

const USAGE = `revab — QE agent framework operator CLI

Usage:
  revab init [--force]     Scaffold .env, register the gateway, seed a sample project
  revab doctor [--json]    Diagnose env, auth, ports, and gateway health
  revab start [--port N]   Start the gateway (all tools, one process: MCP + REST)
  revab --help             Show this message

Docs: README.md · configuration reference: .env.example`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "init":
      await runInit({ force: rest.includes("--force") });
      return;
    case "doctor": {
      const ok = await runDoctor({ json: rest.includes("--json") });
      process.exit(ok ? 0 : 1);
      return;
    }
    case "start": {
      const portIndex = rest.indexOf("--port");
      if (portIndex !== -1 && rest[portIndex + 1]) {
        process.env.GATEWAY_MCP_PORT = rest[portIndex + 1];
      }
      // Imported lazily so `init`/`doctor` never pay the cost of loading every server.
      const { startGateway } = await import("../mcp-servers/gateway/index.js");
      await startGateway();
      return;
    }
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
