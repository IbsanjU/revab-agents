---
name: search-across-sources
description: Federated topic search across Jira, Confluence, JTMF, and GitHub — given a keyword/topic, run all four source searches and return a consolidated list of matches with direct links (and connecting Confluence/GitHub links) so the requester gets every source needed for complete information. Use whenever the user asks to "find", "search", or "look up" a topic instead of citing an issue key, page id, or repo directly.
---
# Search across sources

Composes the existing per-source search tools (`jira_search`, `confluence_search`,
`jtmf_search_tests`, `github_search_code`/`github_search_repos`/`github_search_issues`/
`github_search_commits`) — no new MCP server or I/O is needed, this is purely an
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
   - GitHub: `github_search_code` and `github_search_repos` with `query: "<topic>"`
     (defaults to `GITHUB_ORG`'s repos unless the user names an `org`/`repo`); add
     `github_search_issues`/`github_search_commits` when the user is asking about
     bugs, discussions, or history rather than current code/repos.
2. Run the searches (they're independent — issue them without waiting on each
   other). Each result now carries a direct `url` (Jira/JTMF: browse link; Confluence:
   `_links.webui`-derived link; GitHub: `html_url`) — never fabricate a link if a tool
   didn't return one.
3. For any Confluence page that looks central to the topic, call
   `confluence_extract_links` on it to pull its outgoing hyperlinks, linked pages,
   attachment refs, and Jira issue links — these are the "connecting sources" for
   complete information beyond the initial hit. For any GitHub code hit that looks
   central, use `github_get_file` to pull the full file if more context is needed.
4. Consolidate into a single **Sources** list grouped by system (Jira / Confluence /
   JTMF / GitHub), each entry as `- [<key, title, or repo/path>](<url>) — <one-line
   summary>`. Note when a Confluence page's `confluence_extract_links` output
   surfaced further related sources, and list those underneath the page that
   referenced them.
5. If a query returns nothing from a source, say so explicitly (e.g. "No JTMF test
   cases found for this topic", "No GitHub code matches in <org>") rather than
   omitting the source silently.
6. **Best-practice / external topics**: when the ask is about general practices (e.g.
   "playwright best practices") rather than org-internal work, add
   `github_search_topics` with `scope: "public"` — label these results **external**
   and org hits **internal** in the Sources list.
7. **Confluence page trees**: when a central hit is a parent page, walk it with
   `confluence_get_children` and present a table of contents (title + one-line summary
   per child) so the user can pick pages before pulling full content.
8. **Suggest, then pull**: this skill is read-only. After presenting Sources, ask
   which entries to pull locally and into which project folder, then use the
   ask-before-save tools (`confluence_save_page`, `jira_save_issue`,
   `github_save_file`) with the confirmed `project`.

## Output
Respond with exactly these sections, in this order:
1. **Sources** — grouped by system (Jira / Confluence / JTMF / GitHub), each entry `- [<key, title, or repo/path>](<url>) — <one-line summary>`; connecting links nested under the page that surfaced them; external results labeled **external**.
2. **Empty sources** — every system that returned nothing, stated explicitly.
3. **Next step** — the suggest-then-pull question: which entries to save locally and into which project folder.

## Rules
- Never invent a url — only surface links returned by the tools.
- Prefer this skill over calling a single source's search in isolation when the
  request is topic-based rather than a known issue key/page id/repo.
- GitHub search is read-only here; never scaffold, commit, or push anything as part
  of this skill.
- If the researcher agent is producing a research brief, fold these results into its
  existing **Sources** section instead of duplicating structure.
