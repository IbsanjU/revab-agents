# revab agents — VS Code extension

Starts the [gateway](../README.md#gateway--one-process-mcp--rest) when your workspace opens and
registers its QE tools with VS Code, so nobody has to run servers by hand.

## What it does
- **Auto-starts the gateway** (one process hosting all 76 tools) and shows its state in the status bar.
- **Registers it with VS Code MCP** where that API exists; otherwise falls back to `.vscode/mcp.json`
  (run `npx revab init` to add the entry).
- **Detects an already-running gateway** instead of fighting over the port.
- **Verifies it actually came up** by polling `/health` — it never reports success it didn't observe.

## Commands
| Command | Does |
| --- | --- |
| `revab: Start / Stop / Restart gateway` | Manage the gateway process |
| `revab: Run doctor` | Opens a terminal running `npx revab doctor` |
| `revab: Show available tools` | Quick-pick over every tool, searchable by description |
| `revab: Auto-approve read-only tools` | Writes approval defaults (see below) |

## Settings
| Setting | Default | Meaning |
| --- | --- | --- |
| `revab.gateway.port` | `7300` | Gateway port (loopback only) |
| `revab.gateway.autoStart` | `true` | Start automatically on workspace open |
| `revab.gateway.command` | `npx revab start` | How the gateway is launched |

## About approval prompts — read this

Per-call tool confirmation is a **VS Code security setting owned by you**, not something an
extension can (or should) silently switch off. What this extension does instead:

`revab: Auto-approve read-only tools` writes explicit approval defaults into **workspace**
settings — the 44 read-only tools auto-approved, the 32 write tools set to `false` so they keep
asking every time. The read/write split is served by the gateway itself (`risk` on `/api/tools`),
so there's one classification, not a copy that can drift.

Classification is **fail-closed**: an unrecognized tool counts as a write. And writes remain behind
the framework's dryRun-first guard regardless of what the editor approves — the preview still has
to be confirmed before anything is created.

The exact setting id varies across VS Code versions; if it can't be written, the extension says so
and tells you to use the prompt's "Always allow" instead.

## Build
```bash
cd extension && npm install && npm run build
```
