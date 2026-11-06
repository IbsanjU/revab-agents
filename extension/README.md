# revab agents — VS Code extension

One install gives every VS Code window the QE agents and their tools, whichever folder is open.

- **Agents.** The orchestrator and specialists are bundled (`contributes.chatAgents`), so they appear in the Chat agent dropdown everywhere. Pick **orchestrator**; it dispatches to the others.
- **Tools.** The gateway's tools are registered with VS Code's MCP support as `gateway` (every tool) and `gateway-code` (the two-tool [Code Mode](../docs/code-mode.md) endpoint).
- **One shared gateway.** It runs in the background, started detached from your `revab-agents` checkout. Every window reuses it, and closing a window does not stop it.

## Install

```bash
# once, in your revab-agents checkout
npm install
npm run build:prompts      # only if you changed prompts/
npm run extension:install  # builds the .vsix and runs `code --install-extension`
```

No `code` command on your PATH? `npm run extension:package` builds `extension/revab-agents-<version>.vsix`; install it from the Extensions view (⋯ → Install from VSIX…).

Then, once:

1. **Point it at your checkout.** Run **revab: Choose framework folder**, or set `revab.home` to the checkout's path. (If a window already has the checkout open, it is found automatically.)
2. **Add credentials** to `<checkout>/.env` (copy `.env.example`; `npx revab init` does this). Then run **revab: Run doctor**. Restart the gateway after editing `.env`.
3. **Add your test project** to `<checkout>/projects/manifest.json`.

## Commands

| Command | Does |
| --- | --- |
| `revab: Choose framework folder` | Pick and validate your checkout, then start the gateway |
| `revab: Start / Stop / Restart gateway` | Manage the shared gateway. Stop only affects a gateway this extension started |
| `revab: Run doctor` | Checks env, auth and ports in a terminal |
| `revab: Show available tools` | Searchable list of every tool |
| `revab: Open gateway log` | `<checkout>/.revab/gateway.log` |
| `revab: Auto-approve read-only tools` | Writes approval defaults (see below) |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `revab.home` | empty | Path of your `revab-agents` checkout |
| `revab.gateway.port` | `7300` | Gateway port (loopback only) |
| `revab.gateway.autoStart` | `true` | Start (or reuse) the gateway when a window opens |
| `revab.nodePath` | `node` | Node.js used to run the gateway |
| `revab.gateway.command` | empty | Advanced: replace the launch command |

The gateway runs the compiled CLI if you have run `npm run build`, otherwise the TypeScript sources through tsx. It needs Node and the checkout's `node_modules`; nothing is downloaded at launch.

## Uninstall

```bash
npm run extension:uninstall -- --dry-run --purge-config   # see exactly what would change
npm run extension:uninstall -- --purge-config
```

This stops the gateway the extension started and removes the extension. `--purge-config` also removes revab's own entries from this checkout: `gateway`/`gateway-code` in `.vscode/mcp.json` and `.mcp.json` (only entries pointing at a local gateway), `revab.*` and the tool approvals revab wrote in `.vscode/settings.json`, and `.revab/`. It never touches `.env`, `knowledge/`, `projects/`, or any other server or setting. If you set `revab.home` in your user settings, delete it there.

## Approval prompts

Per-call confirmation is a VS Code setting you own. **revab: Auto-approve read-only tools** writes explicit defaults into *workspace* settings: read-only tools auto-approved, every write set to keep asking. The read/write split comes from the gateway itself (`risk` on `/api/tools`). Classification is fail-closed, and writes also stay behind the framework's dryRun-first guard. `codemode_execute` is classified a write on purpose, so running a script still asks.

## What is and is not verified

Verified by tests, without an editor: the launch logic, one detached gateway shared by repeated starts, stop, a bad `revab.home`, the MCP provider returning class instances with the right labels, and the manifest matching the generated agents. The VSIX builds.

**Not verified: a real VS Code.** That VS Code lists the bundled agents, accepts the MCP provider, and resolves the agents' `gateway/<tool>` references against the extension-provided server has not been tried. See `docs/RUNBOOK.md` §3c for the checks. If the agents' tool references do not resolve, the fallback is a `.vscode/mcp.json` with the same `gateway` entry.

If a workspace also has `.vscode/mcp.json` entries for `gateway`, you may see the servers twice; remove the file's entries, or the extension's.

## Build

```bash
cd extension && npm install && npm run build
```

Requires VS Code 1.101 or newer (the stable MCP provider API).
