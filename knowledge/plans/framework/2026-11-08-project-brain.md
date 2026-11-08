# Plan: a self-updating project knowledge system ("project brain")

Status: **proposed, waiting for approval.** Nothing in this plan has been built. Written from the two prompts (project knowledge system; QE program coordination). The second is folded into the first, as the first asks.

## 1. What I found, and what I will reuse

Inspected: this repo, plus the four other checkouts in this environment (`playwright-playbook`, `playwright-mcp-vscode`, `linkedin-agent-skill`, `ecc`).

| Need | Found | Verdict |
|---|---|---|
| Agent format | 10 agents as typed specs in `prompts/agents/*.ts`, generated into `.github/agents/*.agent.md`, `.claude/agents`, `AGENTS.md`; drift-checked by CI; capability evals | **Reuse.** New agents are specs, not hand-written `.md` |
| Skills | 34 skills in `skills/*/SKILL.md`, frontmatter-validated, tracked in a generated capability graph with a ratcheted baseline | **Reuse** for the skill registry, tests and `registry.yaml` equivalent |
| Work queue | `orchestrator/queue.ts`: file-based pending/running/done/failed with stale-claim recovery. **No `TASKS.md` and no "dual ID" convention exists here** | Reuse the queue's claim/stale logic; build per-project `TASKS.md` on top (see Q5) |
| Provenance | `utils/citation.ts` (hard rule 9: a citation must name something openable, incl. `transcript:<id>@HH:MM:SS`) | **Reuse**; add `vault:<source>#L12-18` |
| Learning | `knowledge/lessons.md` (atomic lessons, computed confidence, promotion rule), `learnings.md`, `capture-learning`, `skillify`, `self-improve` | **Reuse** as the skill-smith's foundation |
| Graph + drift check | `utils/capabilityGraph.ts` (nodes, edges, findings, baseline ratchet, Mermaid) | **Reuse the pattern**; the new graph is a different graph |
| Safe summaries | `utils/recordingSummary.ts` (scrub tokens, strip query strings, no values) | **Reuse** the scrubber for the secrets/PII gate |
| Trust boundary | `projects/manifest.json` + `utils/manifest.ts`; every project-scoped tool resolves a project through it | **Reuse**: a project's brain only exists for a manifest project |
| Fetch/convert | `scripts/confluence-sync-project.ts` (CLI, hash-aware attachments), media tools (PDF, DOCX, XLSX, CSV, OCR, diagrams), `scripts/batch-media-extract.ts` | **Reuse** as ingest adapters. They already run as plain CLI, so no MCP |
| Test-plan docs | `skills/qe-test-plan-builder` (15-section plan, case template, `verify_plan.py`) | **Reuse** as the first document pattern (prompt 2's test plan / test case) |
| Transcription | faster-whisper, local, PR #17 (open, you deferred it) | Not on master. Pasted transcripts first; see Q6 |
| Zero external AI | `check:conventions` rule 6, `docs/behavior-evals.md` | **Keep.** Extraction is done by the Copilot agent, never by this repo calling a model |
| Scheduled runs | `.github/workflows/ci.yml` only (PR checks). No scheduled workflow | New, Phase 7 |

**Not found in this environment** (so I cannot reuse or inspect them): your RAG service (FastAPI/pgvector), your existing ingestion pipelines and their scheduled Actions, your "agent workspace" conventions (TASKS.md, dual IDs, sub-agents), your qe-program-coordination prompt as a file (I have it only as this prompt). I will not guess their shape. See Q5.

## 2. Architecture

### 2.1 The one design idea
There is no model API, so **the Copilot agent proposes and a CLI validates and commits.** The agent never edits a JSONL file by hand. It calls `brain claim add`, `brain entity add`, `brain term add`, and the CLI checks the schema, that the cited line range exists in the vault, ids, duplicates, and authority, then appends. Deterministic work (convert, hash, chunk, diff, supersede, impact analysis, graph build, index, validate, report) is code. Semantic work (reading a chunk and deciding what claims it holds) is the agent, in a Copilot session, driven by small "work packets" the CLI emits. That fits "agents are not always on": packets wait in `TASKS.md` until a session picks them up.

### 2.2 Layers (your section 4, with the changes below)
L0 vault → L1 extraction → L2 knowledge store → L3 learned assets → L4 agents → L5 outputs, each layer reading only from the one below. Unchanged.

### 2.3 Changes to your layout, and why

| Your layout | Proposed | Why |
|---|---|---|
| Data in `knowledge/projects/<slug>/…` inside the repo | Data root is `BRAIN_HOME`, default **`.brain/`** (gitignored), overridable to any approved path. Code, schemas, templates, skills, agents and sanitized `examples/` are committed; vaults, extracted data, graphs and outputs are not | A vault holds raw project documents and transcripts. Committing them to a code repo is the riskiest default. `DATA_HANDLING.md` and the pre-commit gate make it explicit |
| `knowledge/` | Keep `knowledge/` as the framework's own memory (`memory.md`, `lessons.md`, …) | It already means that here |
| `agents/project-brain/*.agent.md` | Specs in `prompts/agents/`, generated | One source, drift check, capability evals, all three hosts |
| `tools/*.py` | `scripts/brain/*.ts` behind one CLI: `npm run brain -- <command>` | Repo convention is TypeScript everywhere; no new language, shares `utils/`; Python is used once (`verify_plan.py`). See Q2 |
| `project.yaml` | `projects/<slug>/project.json` (existing, manifest-resolved) plus an optional `brain` section | Existing trust boundary. Human-edited YAML (lexicon, patterns) still needs a parser: see Q3 |
| 8 agents (prompt 1) + coordinator and 8 stage agents (prompt 2) | **5 agents**: `brain-coordinator`, `brain-ingest` (ingest + extract), `brain-knowledge` (reconcile + graph + cross-project), `brain-docs` (doc-builder), `brain-skills` (skill-smith). Prompt 2's stage agents become **skills** the doc agent runs | 10 agents already crowd the chat dropdown; stages are procedures, not personas |
| "program" (prompt 2) | "project". `programs/<slug>/…` becomes `<BRAIN_HOME>/projects/<slug>/outputs/…` | One concept, one trust boundary |
| `knowledge/global/` | `<BRAIN_HOME>/global/` | Cross-project data is as sensitive as project data |

### 2.4 No dependency on MCP
Every operation is a CLI command or a file. Brain agents hold only built-in tools (read, search, edit, terminal); a capability eval asserts they hold **no** `mcp__*` tool. The existing Jira and Confluence agents still use the gateway; for the brain they are only optional *sources*, reached through the existing CLI scripts or through exports you drop in the vault. Optional read tools on the gateway may come in Phase 7 for people who have it; nothing needs them.

### 2.5 Storage and retrieval (updated: vector store and RAG app are approved)
You confirmed a vector store or an integrated RAG app may be used. That changes the plan in three ways: retrieval is a first-class interface from Phase 1, the RAG/vector adapter moves from Phase 7 to Phase 2, and network use is allowed for **that one service only**.

- **Files stay the source of truth.** Claims, entities, relations, chunks and the vault live in files. The RAG index is **derived and rebuildable**: `brain rag rebuild` recreates it from the files. Losing it costs time, never knowledge. Nothing requires a server; the file default needs no new dependency.
- **`Retriever` interface** (query, filters for project / type / status / authority / date range; returns passages with `chunk_id`, `source_id`, line range, score). Implementations: `FileKeyword` (default, BM25-style in plain TypeScript), `RagApp` (HTTP to your RAG service), `VectorStore` (direct, only if the RAG app lacks an API). Hybrid retrieval fuses keyword, vector and graph-neighbour results with reciprocal-rank fusion.
- **RAG results are candidates, never authority.** Every hit is re-checked against the vault (chunk id, content hash, line range) and against claim status before it is cited. A stale or superseded hit is dropped and counted. This keeps a lagging index from resurrecting outdated facts.
- **Sync, not copy.** On ingest and reconcile the CLI pushes new chunks with metadata (`source_id`, line range, authority, status, hash, project) and removes or marks superseded ones, using content hashes so unchanged chunks are skipped (the hash-based freshness design of your existing service, used as a reference).
- **Network and data guardrails.** The only network target is the endpoint in the brain config (`brain.rag.endpoint`), credentials from environment variables or the OS keyring, never files. Per-project opt-in (`brain.rag.enabled`). `brain scan` runs before any push; chunks from `sensitivity: restricted` sources are never pushed; every push is logged (counts and ids, never text). Any other network target still stops for approval.
- **Retrieval only, no generation.** I use the RAG app's query, upsert and delete endpoints. If it also offers answer generation backed by an LLM, I will not call it, to keep the rule that this system calls no model API (Q5).
- **Embeddings** are computed by your RAG app or its store, so this repo needs no embedding model and no dependency beyond the built-in `fetch`.
- **Other adapters** (SQLite, a graph database) remain optional and later.

### 2.6 Status taxonomies (no change, one mapping)
Claims use `agreed | proposed | disputed | superseded | withdrawn` (prompt 1). Deliverable rows use `Agreed | Proposed | Gap - confirm | Owner TBC | Out of scope` (prompt 2). I keep both and add a fixed mapping: a row is `Agreed` only when its backing claim is `agreed`; `Gap - confirm` when no owner claim exists; `Owner TBC` when the topic was never covered. Prompt 2 asks me to ask before changing its taxonomy: this does not change it.

### 2.7 One rule I have to reconcile
Prompt 2 rule 5 says "newest dated source wins". Prompt 1 §6 says higher authority wins, then newest, else `disputed`. I plan to apply prompt 1's order, which reduces to prompt 2's rule among sources of equal authority. See Q4.

### 2.8 Safety
- `DATA_HANDLING.md` and a `brain scan` gate (also a pre-commit hook script): credentials, token shapes, emails, phone numbers, and **every name from the gitignored local role-to-person map** (so a real name in a deliverable is caught even though names cannot be detected in general). Blocks on a hit.
- Opinions about individuals: extraction prompts exclude them and the scan flags first-person evaluative phrases about a named role for review. This is heuristic; it will not catch everything and I will say so.
- Writes are confined to `BRAIN_HOME`; vault files are immutable by construction (content-addressed, a rewrite is refused). Deleting or rewriting a vault needs your explicit command.
- Network: only the approved RAG/vector endpoint (2.5), and only for projects that opted in. Ingest adapters that call Jira or Confluence are existing scripts you run; the brain opens no other connections.

## 3. Phases

Effort is a rough range of focused working days for me plus review; it is an estimate, not a commitment. Each phase is one or more PRs you review, like the rest of this repo.

### Phase 1: foundation (3–4 days)
- **Scope:** schemas (JSON Schema + zod) for source, chunk, entity, relation, claim, project config, lexicon; `BRAIN_HOME` resolution inside the manifest boundary; vault with content hashing and versioned re-ingest; line-preserving conversion (Markdown, text, PDF, DOCX, XLSX/CSV via the existing readers; pasted transcripts); line-level chunking; a `Retriever` interface with the file keyword implementation, and `brain search` with citations; `brain validate` with gates 1, 2, 8, 9 stubs and 10; `DATA_HANDLING.md` and `brain scan`; one fully fictional example project in `examples/`.
- **Deliverables:** `npm run brain -- ingest|chunk|index|search|validate|scan|next`.
- **Acceptance:** every line of every example source maps to exactly one chunk (gate 1); re-ingesting the same file links instead of duplicating; a changed file creates a new version; a planted credential and a planted role-map name both fail the scan; works with files only.
- **Risks:** line fidelity across formats (PDF and DOCX have no native lines: I define a stable "rendered line" and record it); large files.

### Phase 2: knowledge and retrieval (7–9 days)
- **Scope:** the RAG/vector adapter (contract tests against an in-process fake server; `brain rag push|status|rebuild|query`; hybrid fusion; re-verification of every hit against the vault; supersession propagation; pre-push scan and push log), plus `brain claim|entity|term add` (validating writers); extraction work packets; entity resolution (exact, alias, normalized, fuzzy with an "ask" threshold); graph build from claims (entities and relations are views); primary-document proposal and `primary-sources.md`; project lexicon; offline single-file graph viewer; gates 3, 4, 9.
- **Acceptance:** with the fake server, a superseded chunk never appears in an answer even when the index still returns it; `rag rebuild` reproduces the index from files; a restricted source is never pushed; every node and edge on the example graph traces to a source line; a planted conflict is marked `disputed`, not resolved; the viewer opens from the file system with no network at phone width, light and dark.
- **Risks:** I cannot reach your real RAG service from here, so Phase 2 proves the contract against a fake and **needs one supervised run against your instance** before it counts as done. Extraction quality depends on the Copilot session and its context window, so packets are small and resumable; fuzzy matching false merges (all merges below the threshold go to an uncertain list).

### Phase 3: currency (4–5 days)
- **Scope:** versioning, supersession, `brain reconcile` (claim diff, impact analysis across entities, outputs and skills, change report), the two-timeline model (`valid_from/to`, `recorded_at`) and "as of" queries, corrections as top-authority claims that also become lexicon rules and are applied to existing outputs and transcripts.
- **Acceptance (your criteria 2 and 3):** adding a newer requirement version supersedes the old claims, patches the affected outputs and writes a change report with no manual step; one correction is applied to every existing and future output.
- **Risks:** impact analysis completeness (mitigated by recording which claim ids each output used).

### Phase 4: documents (5–6 days)
- **Scope:** pattern learning from examples; generation from graph queries; the lexicon check on every output; learning from my edits (diff against the last generated output, classify as content/structure/wording/terminology, update the pattern or lexicon, changelog the why). The prompt 2 stage set arrives here as skills under `skills/qe-program-coordination/` (program card and glossary, meeting notes, capability matrix, RACI, test plan and cases, decision log, risk register, workaround log, evidence pack, sign-off matrix, status update), reusing `qe-test-plan-builder` for the plan and cases. Gates 5, 6, 7.
- **Acceptance:** the sample project yields every deliverable and `validate` passes; an edit I make changes the next generation; a second unrelated project needs no agent change.
- **Risks:** pattern inference from few examples is weak, so each pattern shows its examples and says when it has fewer than three.

### Phase 5: skills (3–4 days)
- **Scope:** session retrospectives, repeated-procedure detection (extends `lessons` and `skillify`), skill proposals and patches as diffs, fixtures under each skill's `tests/`, a skill test runner, a registry check (gate 10). New skills and major versions stop for approval; minor patches that pass tests auto-apply and appear in the session report.
- **Acceptance (your criterion 6):** after three recorded sessions on the example, a repeated procedure becomes a tested skill or a patch.
- **Risks:** noisy proposals (a proposal needs two observations).

### Phase 6: cross-project (3–4 days)
- **Scope:** `global/` store, `same_as` after resolution with an uncertain-links queue, `brain prior-work` on project creation, shared lexicon promotion at two or more projects, viewer toggle for cross-project links. A second fictional project shares teams and systems with the first.
- **Acceptance (criterion 7):** the viewer shows the shared links and the second project reuses the first project's patterns; no confidential detail from one project appears in the other's outputs.
- **Risks:** leakage between projects, so outputs may only link to the source project, and a test asserts it.

### Phase 7: scale (3–5 days, needs approvals)
- **Scope:** optional SQLite and graph-database adapters; scheduled ingestion by a GitHub Action or script for the deterministic stages only (including the RAG sync); retrieval evaluation set and gate 11 against your instance; optional gateway read tools.
- **Acceptance (criterion 8):** swapping in an adapter changes nothing outside the adapter.
- **Risks:** secrets in Actions, embeddings that must be local; both stop for approval.

Total: roughly 28–37 working days of effort across seven reviewable stages. I would stop for your review after each phase.

## 4. First ten tasks for `TASKS.md`
1. Confirm answers to Q1–Q6 and record them in this plan.
2. Add `BRAIN_HOME` resolution and the manifest check (`utils/brain/home.ts`) with tests.
3. Write the schemas (source, chunk, claim, entity, relation, project config) as zod, export JSON Schema into `schemas/`.
4. Vault: content-addressed store, immutable writes, hash-based dedupe and versioning.
5. Converters to line-numbered Markdown (text, Markdown, pasted transcript, then PDF, DOCX, XLSX/CSV via existing readers).
6. Line-level chunker and gate 1.
7. Keyword index and `brain search` with `vault:` citations (extend `utils/citation.ts`).
8. `DATA_HANDLING.md`, `brain scan` (secrets, PII shapes, role-map names) and the pre-commit hook script.
8b. In-process fake RAG server for contract tests (needed at the start of Phase 2, once Q5 is answered).
9. Fully fictional example project in `examples/` with a planted conflict, a planted credential and a revised document.
10. `brain validate` wiring, `npm run brain -- next`, CLI docs, and the Phase 1 acceptance run.

## 5. Open questions (the ones that change the design)

- **Q1. Where does project data live?** My default is `.brain/` (gitignored), overridable to a path you approve; only code, schemas and sanitized examples are committed. Is that right, or do you want vaults inside the repo (`knowledge/projects/…`)? The latter means project documents in git history.
- **Q2. TypeScript or Python for `tools/`?** I recommend TypeScript (repo convention, no new language, reuses citation, manifest and readers). Python would mean a second toolchain and a duplicate of the readers.
- **Q3. May I add the `yaml` package from the approved mirror?** Lexicons, patterns and project settings are human-edited YAML and there is no YAML parser here. One dependency, no transitive ones. Otherwise I use JSON for everything, which is less pleasant to edit.
- **Q4. Which conflict rule is authoritative?** Authority first, then newest, else `disputed` (prompt 1), or "newest wins" (prompt 2 rule 5)? I will apply the first unless you say otherwise.
- **Q5. Your RAG app or vector store: I need its shape.** It now matters for Phase 2, not Phase 7. Please give me, or point me at:
  1. How I reach it: base URL (read from an environment variable) and how it authenticates.
  2. The endpoints for upsert, delete and query, and what a query returns (text, metadata, score).
  3. Whether it embeds text itself (my assumption) or expects vectors from me.
  4. Whether it separates data per project (a collection or tenant each) and supports metadata filters (status, authority, source).
  5. Whether it offers answer generation backed by an LLM. I will not call that (no model API from this repo).
  6. If there is no HTTP API and I would talk to the vector store directly (for example pgvector): that needs a database client dependency (Q3) and an embedding source, and I would rather avoid it.
  If you cannot share it, I define the adapter contract, test it against a fake, and you map your service to it. Still open: your existing ingestion pipelines and scheduled Actions, and your TASKS.md / dual-ID convention; otherwise I define a format.
- **Q6. Transcripts:** pasted transcripts only until PR #17 (local faster-whisper) is merged, or do you want #17 merged first? Also: do custom agents (`.github/agents`) load in your JetBrains Copilot? I cannot test that here. If not, the skills and instructions still work, but agent selection will not.
- **Approvals needed to start Phase 1:** write access beyond your folder list, to `prompts/agents/`, `utils/brain/`, `scripts/brain/`, `evals/`, `docs/`, `package.json` scripts and `.gitignore`, because the repo's agents, tests and checks live there.

## 6. What I will not do without asking
Add a dependency, connect to any network service **other than the one RAG/vector endpoint you approved**, confirm a primary document, merge two entities across projects, accept a disputed claim, create a skill or a major skill version, or delete or rewrite a vault.
