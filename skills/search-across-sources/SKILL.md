---
name: search-across-sources
description: Federated topic search across Jira, Confluence, and JTMF — given a keyword/topic, run all three source searches and return a consolidated list of matches with direct links (and connecting Confluence links) so the requester gets every source needed for complete information. Use whenever the user asks to "find", "search", or "look up" a topic instead of citing an issue key or page id directly.
---
# Search across sources

Composes the existing per-source search tools (`jira_search`, `confluence_search`,
`jtmf_search_tests`) — no new MCP server or I/O is needed, this is purely an
orchestration playbook.

## Steps
1. Turn the user's topic into per-source queries:
   - Jira: free text over summary/description, e.g. `jira_search` with
     `jql: 'text ~ "<topic>*" ORDER BY updated DESC'` (add `project = X` if the user
     named a project).
   - Confluence: `confluence_search` with `query: "<topic>"` (free text; add
     `spaceKey` if named).
   - JTMF: `jtmf_search_tests` with `jql: 'text ~ "<topic>*"'` to surface existing test
     coverage on the same topic.
2. Run the three searches (they're independent — issue them without waiting on each
   other). Each result now carries a direct `url` (Jira/JTMF: browse link; Confluence:
   `_links.webui`-derived link) — never fabricate a link if a tool didn't return one.
3. For any Confluence page that looks central to the topic, call
   `confluence_extract_links` on it to pull its outgoing hyperlinks, linked pages,
   attachment refs, and Jira issue links — these are the "connecting sources" for
   complete information beyond the initial hit.
4. Consolidate into a single **Sources** list grouped by system (Jira / Confluence /
   JTMF), each entry as `- [<key or title>](<url>) — <one-line summary>`. Note when a
   Confluence page's `confluence_extract_links` output surfaced further related
   sources, and list those underneath the page that referenced them.
5. If a query returns nothing from a source, say so explicitly (e.g. "No JTMF test
   cases found for this topic") rather than omitting the source silently.

## Rules
- Never invent a url — only surface links returned by the tools.
- Prefer this skill over calling a single source's search in isolation when the
  request is topic-based rather than a known issue key/page id.
- If the researcher agent is producing a research brief, fold these results into its
  existing **Sources** section instead of duplicating structure.
