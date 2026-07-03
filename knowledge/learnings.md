# Learnings

Persistent, dated session learnings. Agents append here (via the artifacts `knowledge_append` MCP tool or direct edit) and read this before starting work. Keep entries short and factual; delete entries proven wrong.

Entry format:

### YYYY-MM-DD
- What was learned / decided / failed and why.

---

### 2026-07-02
- Framework scaffolded: 4 local MCP servers (jira 7311, confluence 7312, jtmf 7313, artifacts 7314), file-queue orchestrator, Playwright+Cucumber+Allure skeleton, 7 agent chat modes.
- JTMF custom fields are org-specific: set `JTMF_STEPS_FIELD` in `.env` before test-case tools return steps.
