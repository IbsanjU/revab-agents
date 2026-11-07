---
name: ship
description: Produce a go / no-go release-readiness report for a target project — test results, open defects, change scope and rollback readiness — with every line backed by evidence or marked UNKNOWN. Use when asked "can we ship", "release readiness", "go/no-go" or before a release sign-off. Report-only — it never pushes, tags, deploys, merges or transitions anything. Skip for a failure post-mortem (use analyze-test-failures) or when no release scope can be identified (say so).
---
# Ship

Shipping is a decision a person makes. This skill gathers the evidence for that decision and
states plainly what is known, what is not, and what blocks. It never performs the release.

## Rules
- **Unknown is not pass.** A check you could not run or could not read is `UNKNOWN`, and
  `UNKNOWN` on a required check makes the verdict `NO-GO` or `GO WITH CONDITIONS`, never `GO`.
- **Evidence or it did not happen.** Each line cites its source: an Allure result, a
  `git_log` range, a Jira key (`jira_search` JQL), or `file:line`. No citation → `UNKNOWN`.
- **Report only.** Never push, tag, merge, deploy, or call `jira_transition_issue`. Any Jira
  write (e.g. a release comment) is dryRun-first and only after the user approves.
- **Target project only.** Resolve the project from the manifest; never run suites against
  revab-agents itself.
- **Do not re-run to turn red green.** If results are stale, say how old they are and run the
  suite once; record flakiness instead of retrying.

## Steps
1. **Scope the release.** From the manifest-resolved project, `git_branches` and `git_log`
   (the range since the last release tag or the date the user gives) → what is changing.
   If the range cannot be determined, ask once; otherwise stop with `UNKNOWN`.
2. **Test evidence.** `allure_summary` (run `run_bdd` tag-scoped to the change if results are
   missing or older than the newest commit in scope). Record counts, failures by
   classification, and result age.
3. **Open defects.** `jira_search` for unresolved bugs on the release scope (project/fix
   version the user names). List blockers and criticals by key; note the JQL used.
4. **Change risk.** From the log: size of the change, areas touched, and whether each
   high-risk area has test evidence from step 2. Untested high-risk area → condition.
5. **Rollback readiness.** Is there a stated rollback path (a previous tag/commit to return
   to, a feature flag, a migration reversal)? Find it in the log, the project docs
   (`Read`) or the Jira epic. Not found → `UNKNOWN`, which is a condition at minimum.
6. **Verdict.** Combine: any failed required check or open blocker → `NO-GO`; all required
   checks passing with some `UNKNOWN`/untested areas → `GO WITH CONDITIONS` (list them);
   everything evidenced and clean → `GO`.

## Output
- **Verdict**: GO / GO WITH CONDITIONS / NO-GO, one sentence why.
- **Checklist table**: check · status (PASS / FAIL / UNKNOWN) · evidence (citation).
- **Blockers**: each with owner and the smallest action that clears it.
- **Conditions**: what must be true or watched after release.
- **Not checked**: anything outside this skill's reach (deploy pipeline, monitoring,
  approvals) so nobody assumes it was covered.
- Offer the Jira/Confluence write-up as a dryRun preview; do not post unprompted.
