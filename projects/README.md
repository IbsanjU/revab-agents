# projects/

One folder per target project, plus an index. This directory is the **trust boundary**:
only projects listed in `manifest.json` are resolvable by any MCP tool or orchestrator task.

```
projects/
  manifest.json            # index: project names only (the trust boundary)
  <project-name>/
    project.json           # full config: repoPath/repoUrl, testPaths, jira/confluence/jtmf ids, execution mode
    app-model.md           # living app map (moved from knowledge/app-model/<project>.md)
    team-roster.json       # component/label/issueType -> assignee accountId, for the bsa agent's route-assignee skill
    downloads/             # pulled Jira/Confluence/GitHub content for this project
    reports/               # consolidated project reports
    test-plans/            # persisted test plans
```

- `project.json`'s `name` must match its folder name.
- The legacy single-file `projects.manifest.json` at the repo root is still supported
  for backward compatibility (`utils/manifest.ts` falls back to it when
  `projects/manifest.json` is absent), but new setups should use this layout.
- `my-project` is a placeholder template — copy the folder, rename it, and fill in
  `project.json` to add a real project.
