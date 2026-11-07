# Extension roadmap

## Phase 1 (built): one install, every window

Bundled agents, MCP registration for `gateway` and `gateway-code`, one shared detached gateway started from the checkout named by `revab.home`, packaging, install and uninstall scripts. See `extension/README.md`.

What phase 1 still needs from you: a clone of the repo with `npm install` run once, and credentials in the checkout's `.env`.

## Phase 2 (built): credentials and tools in the extension

Delivered: no hand-edited `.env` needed, and tools you can switch on and off. Details in `extension/README.md`. The design below is what was built, with these differences: non-secret values are one allowlisted `revab.environment` object rather than a setting per variable, and the gateway reports disabled tools in `/api/tools` so the picker can show them as off.

**Credentials.** A **revab: Set credentials** command asks for each service (Jira, Confluence, JTMF, GitHub, notifications) and stores the secret in VS Code's `SecretStorage`, never in settings JSON. On start, the extension passes them to the gateway as environment variables, which the gateway already reads (`JIRA_API_TOKEN` and the rest); a value in `.env` still works and the extension's value wins. Non-secret values (base URLs, emails, custom field ids) become ordinary `revab.*` settings. The gateway never needs to learn about VS Code.

**Enable and disable tools.** A `revab.tools.disabled` setting (a list of tool names or `server/*` patterns) and a quick-pick **revab: Choose tools** over `/api/tools`. The gateway gains `GATEWAY_DISABLED_TOOLS`, applied where tools are captured, so a disabled tool is absent from MCP, REST and Code Mode alike rather than merely hidden in the editor. Changing it restarts the gateway.

Constraints to design around:
- Secrets passed as environment variables are visible to that process's children. The gateway already runs tool handlers in its main thread, and Code Mode's sandbox has an empty environment.
- Disabling a tool an agent's spec lists would break that agent. The picker should warn, and the capability evals (`npm run eval`) remain the check.
- Credentials are per machine, not per workspace: store them at user scope.

## Phase 3 (built): no clone at all

Delivered. The gateway is bundled into the VSIX (esbuild, one 5.5 MB file plus `tesseract.js`, `pdfkit` and `pdf-parse` with their dependencies, 27 MB compressed, JavaScript and WASM only) and runs with `node`. No `REVAB_HOME` variable was needed: every read goes through `process.cwd()`, so the extension simply runs the gateway in a home folder it creates in its own storage (`extension/src/seed.ts`). See `extension/README.md`.

What the survey found and how it was handled: only one `import.meta.url` (the main-module guard, disabled in the bundle by `REVAB_BUNDLED`), one variable dynamic import (`mcp-servers/gateway/tools.ts`, now literal loaders), and `pdf-parse`, which cannot load without a platform-specific native canvas; that is loaded lazily with inert stand-ins when the canvas is absent (`utils/pdfParse.ts`), so the VSIX stays platform-neutral.

Still open: the bundle has only run on Linux; the task queue and `build:prompts` need a checkout; OCR needs network on first use.
