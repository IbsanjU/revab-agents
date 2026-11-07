# Browser verification and session recordings

Two small integrations let the agents look at a real browser without handing them an open one. Both were exercised against real software on Linux; what was not is listed at the end.

## 1. `verify` drives the real UI (opt-in)

`verify` used to run a suite and read its results. It can now also open the page the change affects, through the policy-controlled browser server [`playwright-mcp-vscode`](https://github.com/IbsanjU/playwright-mcp-vscode).

```bash
npm install --save-dev github:IbsanjU/playwright-mcp-vscode
(cd node_modules/playwright-mcp-vscode && npm run setup)   # downloads the headless Chromium
npx revab init --browser --allow-host app.test              # registers it; add --allow-host per app host
```

`init --browser` adds a `playwright-local` entry to `.vscode/mcp.json` and `.mcp.json` and never overwrites one that exists. The entry:

- navigates only to `localhost`, `127.0.0.1` and the hosts you pass; anything else is refused with `SECURITY_POLICY` (checked against the real server);
- has script execution off, so `page_eval` is listed by the server but every call is refused ("disabled by policy"). No agent is granted it;
- is launched with `npx --no-install`, so it fails clearly instead of downloading anything at start-up. A bad `--allow-host` (a URL, a port, a bare `*`) registers nothing rather than an unrestricted server.

`automation` holds `browser_navigate`, `page_snapshot`, `page_click`, `page_type`, `page_wait_for`, `page_console_logs` and `browser_close`. `verify` acts on the accessibility-snapshot `ref` values, not guessed selectors, and reports **BLOCKED** for the UI part when the host is not allowed or no browser tool is available. It does not route around the policy.

## 2. Failure analysis reads a session recording

[`playwright-playbook`](https://github.com/IbsanjU/playwright-playbook) records a browser session to `.playwright-recorder/sessions/<id>/`. The `recording_summary` tool (allure-report server, read-only, takes `project`) gives `reporter` the parts that explain a failure:

- session status and any gaps (an interrupted session or failed writes are listed as **caveats**: weak evidence, say so);
- failed network calls (origin and path only), console errors, page crashes and the last user actions.

Recordings contain credentials, cookies, headers, bodies and typed values. The summary reads only `manifest.json`, `network.ndjson`, `browser-events.ndjson` and `interactions.ndjson`, never returns headers, bodies, typed values or storage state, drops query strings from URLs, and scrubs bearer tokens, JWTs and long hex strings from console text. A test plants secrets in every raw field and asserts none reach the output. The recording must live inside the project's repo (the manifest boundary): copy it there, or pass `recordingDir`.

**VS Code extension:** it registers only `gateway` and `gateway-code`, not `playwright-local`. In an extension-only setup the agents list the `playwright-local` tools but the server is absent, so `verify` skips the UI step and says so. Add the entry to `.vscode/mcp.json` yourself (`revab init --browser` does it in a checkout).

## What was and was not verified

Verified: a real recording (headless, local page with a 500 and a console error) summarized with the secrets scrubbed; the registered browser entry driven over real MCP stdio against a local page (navigate, accessibility snapshot with refs, blocked external host, refused `page_eval`); the `recording_summary` tool through the gateway with a throwaway manifest.

Not verified: a live model actually choosing to use these tools, VS Code or Claude Code loading the `playwright-local` entry, Windows and macOS, headed or attached-Chrome recordings, and recordings with interactions and WebSockets (the real one had none).
