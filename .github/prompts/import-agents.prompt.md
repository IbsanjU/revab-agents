---
description: 'Import agents, scripts and utils from another repository into this centralized repo'
mode: 'agent'
---
Import QE assets from ${input:sourcePath:Absolute path to the source repository}.

Steps:
1. Dry-run first: `npm run import:agents -- "${input:sourcePath}" --dry-run` and show me what would be copied.
2. After I confirm, run the real import.
3. Normalize everything imported per the importer chat-mode rules: kebab-case names, valid frontmatter, env vars instead of hardcoded URLs/tokens (flag any secrets found), rewrite MCP servers onto mcp-servers/shared/.
4. Deduplicate against existing utils/steps and report merges.
5. Append an import record to knowledge/learnings.md and summarize: imported / renamed / merged / skipped / flagged.
