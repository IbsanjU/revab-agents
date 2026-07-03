---
description: 'Build a full test plan and BDD test cases from a Jira epic'
mode: 'agent'
---
Build a complete test plan for epic ${input:epicKey:Jira epic key, e.g. ABC-100}.

Steps:
1. Fetch the epic and all its children via the jira MCP tools (`jira_get_issue`, `jira_get_epic_children`).
2. Search Confluence for related design/test docs (`confluence_search`) and pull the most relevant pages.
3. Check existing JTMF coverage (`jtmf_search_tests`) to avoid duplicates.
4. Produce a risk-based test plan (scope, risks, test types, environment/data needs, traceability table mapping every acceptance criterion to a test case).
5. Write the test cases as Gherkin scenarios with proper tags, ready for tests/features/.
6. Save the plan to knowledge/test-plans/${input:epicKey}.md and ask whether to also create the .feature files.
