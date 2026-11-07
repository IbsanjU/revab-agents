# Lifecycle: Define → Plan → Build → Verify → Review → Ship

A common way to frame agent-assisted work is six phases. This page maps each onto what this repo actually has, and says where coverage is thin. Nothing here is aspirational: every tool and skill named exists on this branch, and gaps are called out.

| Phase | Owner (agent) | Skills | Gateway tools | Coverage |
|---|---|---|---|---|
| **Define** — what are we building and why | `researcher`, `bsa` | `search-across-sources`, `extract-requirements-from-image`, `extract-requirements-from-video`, `structure-project-data` | `jira_get_issue`, `jira_get_epic_children`, `confluence_search`, `confluence_get_page`, `git_log`, `ocr_*`, `read_*_text` | Good. Cited research brief; `bsa` turns raw requirements into tickets. |
| **Plan** | `planner` (mandatory first, rule #13), `test-planner` | `qe-test-plan-builder`, `build-test-plan-interactive`, `test-design-techniques`, `route-to-specialist` | `jira_search`, `confluence_search`, `knowledge_search`, `jtmf_*` | Good. Auditable plan with self-critique; risk-scored test plans with cited Gherkin. |
| **Build** | `automation` | `detect-execution-convention`, `simplify` | `detect_conventions`, `scaffold_feature/step/page`, `get_test_files`, `git_diff` | Good for test code (Playwright + Cucumber). The repo does not write product code. |
| **Verify** | `reporter`, `automation` | `verify`, `analyze-test-failures`, `adversarial-review` | `run_bdd`, `allure_summary`, `get_result_json`, `generate_report` | Good. `verify` requires runtime observation, not just a green suite. |
| **Review** | `orchestrator` | `code-review`, `security-review`, `review-against-spec`, `review-delegated-work`, `adversarial-review` | `consensus_score` | Good. Independent runs plus a sourced critic; disagreement is reported, not smoothed. |
| **Ship** | `reporter` | `ship` | `git_log`, `git_branches`, `jira_search`, `allure_summary` | **Report-only.** A cited go / no-go. It does not release anything. |

## What Ship does and does not do

`ship` gathers evidence and states a verdict: `GO`, `GO WITH CONDITIONS` or `NO-GO`. A check it cannot evidence is `UNKNOWN`, and `UNKNOWN` never counts as a pass. It covers test results, open blockers, change scope and rollback readiness.

It deliberately does **not**:

- push, tag, merge, deploy or transition a Jira issue;
- read CI check-runs (the GitHub tools here have no check-run access), the deploy pipeline or production monitoring;
- replace a human approval.

Those are listed under **Not checked** in every report so nobody assumes they were covered.

## Gaps worth knowing

- **No CI/CD or monitoring tools.** Post-release verification (error rates, dashboards) is outside the toolset.
- **No product-code authoring agent.** `Build` means test automation.
- **Rollback is only checked, never exercised.** Only the planner's spec mentions it, and `ship` marks an unfound rollback path `UNKNOWN`.
- **Not yet run with a live model.** The `ship` skill and its behavior eval (`evals/behavior/ship-unknown-is-not-pass.md`) are written and wired, but no live-model run has been recorded.

## Entry points

Ask the orchestrator in plain words ("can we ship release X?"); the routing table in `route-to-specialist` sends release-readiness to `reporter` via `ship`. Start any non-trivial multi-phase piece of work with `planner`, as before.
