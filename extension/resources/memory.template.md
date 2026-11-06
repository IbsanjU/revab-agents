# revab-agents — framework memory

Read at the start of a session. This folder is the framework's **home**: the gateway runs here, so the paths below are relative to it.

## Layout
- `.env` — optional credentials and settings (the extension can supply these instead; see the extension README).
- `projects/manifest.json` — the only projects the agents may touch (the trust boundary). Each name has a folder `projects/<name>/project.json` that gives the repo path or URL.
- `skills/` — reusable playbooks, refreshed when the extension updates (add your own alongside them; they are not deleted).
- `knowledge/` — `conventions.md` (ticket field conventions), `learnings.md` (what agents learn; yours, never overwritten).
- `.revab/` — gateway log and pid.

## Tools
All tools run inside one gateway process (`GET /api/tools` lists them). Writes to Jira, Confluence and JTMF default to `dryRun: true`: show the preview and get explicit approval for that exact payload before setting `dryRun: false`. `jira_delete_issue` is not registered.

## Not available in this mode
The async task queue (`npm run task`, `npm run worker`) and prompt regeneration (`npm run build:prompts`) belong to a framework checkout. Set `revab.home` to a checkout to use them.
