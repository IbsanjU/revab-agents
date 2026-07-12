# knowledge/plans/

Finalized, planner-approved plans — one folder per project (`framework` for work on
revab-agents itself), one file per plan: `<project>/<YYYY-MM-DD>-<slug>.md`.

Every plan is produced by the planner agent's draft → self-critique → finalize loop and
approved by the user before execution. Orchestrator tasks reference their plan via a
`"plan"` payload field so queue results trace back to the approved plan.
