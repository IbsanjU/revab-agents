# revab agents — VS Code extension

One install gives every VS Code window the QE agents and their tools, whichever folder is open. **No clone of the repository is needed to use it.**

- **Agents.** The orchestrator and specialists are bundled (`contributes.chatAgents`), so they appear in the Chat agent dropdown everywhere. Pick **orchestrator**; it dispatches to the others.
- **Tools.** The gateway's tools are registered with VS Code's MCP support as `gateway` (every tool) and `gateway-code` (the two-tool [Code Mode](../docs/code-mode.md) endpoint).
- **The gateway is inside the extension.** It is bundled (the whole gateway and all eleven servers in one file, plus the few packages that cannot be inlined), and runs from a home folder the extension creates in VS Code's storage. Nothing to install or clone.
- **One shared gateway.** It runs in the background, started detached. Every window reuses it, and closing a window does not stop it.

### Two modes

| | Bundled (default) | Framework checkout |
|---|---|---|
| When | `revab.home` is empty and no open folder is a checkout | `revab.home` is set, or an open folder is a `revab-agents` checkout |
| Gateway | the one shipped in the extension | the checkout's own (compiled, or from source) |
| Home folder | `<VS Code storage>/<publisher.name>/home`, created on first start | the checkout |
| Task queue, `build:prompts`, editing agent specs | not available | available |

A wrong `revab.home` is reported, never silently replaced by the bundle.

## Install

Someone builds the `.vsix` once from a checkout; everyone else just installs the file.

```bash
# in a revab-agents checkout (the person building the extension)
npm install
npm run extension:package   # → extension/revab-agents-<version>.vsix (about 27 MB)
npm run extension:install   # the same, then `code --install-extension`
```

Install the file from the Extensions view (⋯ → Install from VSIX…) or `code --install-extension <file>`. The `.vsix` is platform-independent: it contains JavaScript and WASM only, no native binaries.

Then, once:

1. **Add credentials**, either way (they can be mixed; see below): run **revab: Set credentials** for each token, and put non-secret values in the `revab.environment` setting; or use `<checkout>/.env` (copy `.env.example`; `npx revab init` does this). Then run **revab: Run doctor**.
2. **Add your test project** to `projects/manifest.json` in the home folder (**revab: Open framework home folder** reveals it). Only projects listed there can be touched by the agents.

## Commands

| Command | Does |
| --- | --- |
| `revab: Choose framework folder` | Optional: pick and validate a checkout to run from instead of the bundle |
| `revab: Open framework home folder` | Reveal the home folder (`.env`, `projects/`, `knowledge/`, `skills/`) |
| `revab: Start / Stop / Restart gateway` | Manage the shared gateway. Stop only affects a gateway this extension started |
| `revab: Run doctor` | Checks env, auth and ports in a terminal |
| `revab: Set up speech-to-text` | Installs faster-whisper into a private Python environment so agents can transcribe recordings (`transcribe_media`) |
| `revab: Show available tools` | Searchable list of every tool |
| `revab: Open gateway log` | `<checkout>/.revab/gateway.log` |
| `revab: Set credentials` / `Clear credentials` | Store or delete a token. Stored encrypted by VS Code, never in settings |
| `revab: Show configured credentials (names only)` | Lists what the extension will pass to the gateway; values are never shown |
| `revab: Choose tools (enable / disable)` | Check or uncheck tools; warns which agents lose a capability |
| `revab: Auto-approve read-only tools` | Writes approval defaults (see below) |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `revab.home` | empty | Optional: path of a `revab-agents` checkout to run from. Empty = the bundled gateway |
| `revab.gateway.port` | `7300` | Gateway port (loopback only) |
| `revab.gateway.autoStart` | `true` | Start (or reuse) the gateway when a window opens |
| `revab.nodePath` | `node` | Node.js used to run the gateway |
| `revab.environment` | `{}` | Non-secret values passed to the gateway, e.g. `{ "JIRA_BASE_URL": "https://acme.atlassian.net", "JIRA_EMAIL": "me@acme.com" }`. An allowlist: other names are refused |
| `revab.tools.disabled` | `[]` | Tools switched off: a name, `server/*`, or `prefix*`. Edit it by hand or use **Choose tools** |
| `revab.gateway.command` | empty | Advanced: replace the launch command |

The gateway runs the compiled CLI if it is current, otherwise the TypeScript sources through tsx. A build older than the sources (after a `git pull`, say) is skipped on purpose and the log says so; run `npm run build` to use it again. It needs Node and the checkout's `node_modules`; nothing is downloaded at launch.

## Credentials

Tokens are stored with **revab: Set credentials** in VS Code's secret storage (encrypted, not in `settings.json`, not synced as a setting). When the extension starts the gateway it passes them as environment variables, which the gateway already reads, and they take precedence over the same variable in `.env`. The extension never prints a value: logs and messages name the variable only, with `(secret)` marked. Non-secret values go in `revab.environment`, which accepts only an allowlist of names, so a setting cannot inject `NODE_OPTIONS`, `PATH` or similar into the gateway process, and a token pasted there is refused with a pointer to the command.

Things to know:
- **Changes apply when the gateway starts.** After setting a credential or changing `revab.environment` or the tool list, the extension offers a restart. It can only restart a gateway it started; one you started in a terminal must be restarted there.
- **One gateway, one set of credentials.** The gateway is shared by every window, so credentials are per machine, not per workspace.
- **A running gateway's secret.** If `MCP_SHARED_SECRET` is set the gateway requires it on every request. The extension sends it as the `x-mcp-secret` header on its MCP registrations and its own requests.
- **Environment variables are visible to that process's owner**, as they are with `.env`. This is not a vault; it keeps tokens out of settings files and screenshots.

## Choosing tools

**revab: Choose tools** lists every tool grouped by server, checked when enabled. Unchecked tools are switched off **at the gateway**, so they disappear from MCP, REST and Code Mode for every client, not just this editor. Before saving it warns which agents list a tool you are removing (read from the checkout's generated agent files) and asks you to confirm; those agents keep working but cannot do that step. Hand-written patterns in `revab.tools.disabled` (`jira/*`, `confluence_*`) are kept untouched. `npx revab doctor` repeats the warning and flags an entry that matches nothing, which usually means a typo.

## The home folder (bundled mode)

Created on first start from templates the extension ships, and never emptied. Two kinds of file:

- **Framework-owned, refreshed when the extension updates:** `skills/` (a skill of your own, added beside them, is kept) and `.env.example`.
- **Yours, written only if missing and never overwritten:** `knowledge/` (starting from a short `memory.md` and an empty `learnings.md`, not this repository's own history), `projects/`, and `.env`, which the extension never creates or touches.

It is a normal folder: put `.env` there if you prefer a file to **Set credentials**.

## Limits in bundled mode

- Speech-to-text needs Python 3.9+ on your machine (the extension does not bundle Python). Run **revab: Set up speech-to-text** once; models download on first use.
- No async task queue (`npm run task`, `npm run worker`) and no `build:prompts`: those need a checkout (set `revab.home`). Agents that dispatch with the Task tool are unaffected.
- PDF text and metadata extraction work. PDF.js is given inert stand-ins for its optional native canvas, so nothing can be *rendered*; this repository never renders PDFs.
- OCR (tesseract) downloads its language data on first use, so it needs network access then.
- Tools that act on a target project (`run_bdd`, `scaffold_*`) use that project's own Node and dependencies, as before.
- The bundle has only been run on Linux. Windows and macOS are untested.

## Uninstall

```bash
npm run extension:uninstall -- --dry-run --purge-config   # see exactly what would change
npm run extension:uninstall -- --purge-config
npm run extension:uninstall -- --purge-home               # also delete the bundled home folder
```

This stops the gateway the extension started and removes the extension. VS Code leaves an extension's storage behind, so the bundled home folder (your `.env`, knowledge and projects) is **kept** unless you add `--purge-home`; that deletes it only if it carries the extension's marker file, and lists what it holds first. For VS Code Insiders, VSCodium or a portable install add `--user-data-dir <dir>` (the folder that contains `User/`). `--purge-config` also removes revab's own entries from a checkout: `gateway`/`gateway-code` in `.vscode/mcp.json` and `.mcp.json` (only entries pointing at a local gateway), `revab.*` and the tool approvals revab wrote in `.vscode/settings.json`, and `.revab/`. It never touches `.env`, `knowledge/`, `projects/`, or any other server or setting. If you set `revab.home` in your user settings, delete it there.

## Approval prompts

Per-call confirmation is a VS Code setting you own. **revab: Auto-approve read-only tools** writes explicit defaults into *workspace* settings: read-only tools auto-approved, every write set to keep asking. The read/write split comes from the gateway itself (`risk` on `/api/tools`). Classification is fail-closed, and writes also stay behind the framework's dryRun-first guard. `codemode_execute` is classified a write on purpose, so running a script still asks.

## What is and is not verified

Verified by tests, without an editor: the launch logic (including skipping a stale build), one detached gateway shared by repeated starts, stop, a bad `revab.home`, the MCP provider returning class instances with the right labels and the shared-secret header, a stored credential reaching a real gateway and being enforced, secrets never appearing in the output, messages or gateway log, the `revab.environment` allowlist, disabled tools disappearing from the gateway, the picker's agent warning and cancel, and the manifest matching the generated agents. The VSIX builds.

**Not verified: a real VS Code.** (`docs/RUNBOOK.md` §3d is a 13-step checklist for doing this.) That VS Code lists the bundled agents, accepts the MCP provider, and resolves the agents' `gateway/<tool>` references against the extension-provided server has not been tried. See `docs/RUNBOOK.md` §3c for the checks. If the agents' tool references do not resolve, the fallback is a `.vscode/mcp.json` with the same `gateway` entry.

If a workspace also has `.vscode/mcp.json` entries for `gateway`, you may see the servers twice; remove the file's entries, or the extension's.

Also verified, without an editor: the bundle starts and serves every tool from outside the repository with only its shipped packages (a PDF round trip, Code Mode's sandbox, and file tools reading the home folder all work), `doctor` from the bundle does not start a gateway, and the extension seeds, refreshes and respects the home folder.

## Build

```bash
npm run extension:package      # builds everything (the gateway bundle, templates, agents, VSIX)
cd extension && npm install && npm run build   # just the extension code
```

Requires VS Code 1.101 or newer (the stable MCP provider API). The user running the gateway needs Node.js on their PATH (or set `revab.nodePath`); the extension does not bundle Node.
