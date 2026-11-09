# Plan: project knowledge layer (cited claims, supersession, lexicon, Lore adapter)

Status: **proposed, waiting for approval.** Nothing in this plan has been built. This is the lean, buildable cut of `2026-11-08-project-brain.md` (which stays as the long-range vision). It is written so a small local model (Hermes agent running Gemma ~26B) can build it one task card at a time, with the repo's own checks as the safety net. See "Handoff to a local model".

## 1. Findings: what was assumed, what is true

| Item | Assumed | Found (verified in the repo on master) | Action |
|---|---|---|---|
| This plan file | build prompt says it exists | did not exist; only `2026-11-08-project-brain.md` | this file is it |
| Source files named in the build prompt | exist | all 22 exist (`prompts/shared/*`, `utils/citation.ts`, `manifest.ts`, `fsSafety.ts`, `corrections.ts`, `capabilityGraph.ts`, server/gateway files, skills, scripts, knowledge docs) | none |
| `utils/fsSafety.ts` | a set of helpers | exports exactly one function: `resolveWithinRoot(root, relPath)` | use it for every write; do not assume more |
| Citation | extend with a `vault:` form (my earlier plan) | `validateCitation(source)` / `requireCitation(source)` accept Jira key, `confluence:<id>`, `jtmf:`, `app-model:`, `transcript:<id>@hh:mm:ss`, `path/file.ext:42`, URL | **drop the extension.** A claim cites with an existing form; line range lives in separate fields. No new validator |
| Hard rules | 13 | `HARD_RULES` in `prompts/shared/hard-rules.ts`, records `{n, title, short, full}` | adding a rule is a stop-and-ask (phase 5) |
| MCP | brain prompt: nothing may depend on MCP. Build prompt: a gateway server | **conflict** | logic lives once in `utils/knowledge/`; exposed as a gateway tool server **and** a thin CLI over the same code. Neither is required by the other |
| Data location | `.brain/` (earlier plan) or in-repo | build prompt allows writes only under `projects/` among data folders | data lives in `projects/<name>/knowledge/` (inside the manifest boundary), **gitignored by default** (`.gitignore` is outside the allowed folders: stop-and-ask, task T01) |
| YAML | needed | no YAML dependency; none needed | JSON and JSONL only. No new dependency anywhere in this plan |
| "Lore" | unknown | the user's own RAG app on their mini-PC under Documents/. **Not reachable from this environment** | phase 8 builds against a contract and a fake; a real run happens on the mini-PC |
| Test discovery | tests next to the code are picked up | `npm test` lists globs explicitly (`utils/*.test.ts`, `utils/codemode/*.test.ts`, …). A test in `utils/knowledge/` would **silently not run** | T01 adds `utils/knowledge/*.test.ts` to the `test` script; a card that adds a new folder must check this |
| Gateway tool count | 78 | 79 (`recording_summary` added) | docs drift check will need the new tools listed in README and `memory.md` |

## 2. Design

**Concept kept from the brain prompt:** every fact is a *claim* with a source and line range; claims go stale and are *superseded*, never deleted; sources have *authority*; conflicts are marked *disputed*, never silently resolved; the project's *language* is binding.

**Storage.** `projects/<name>/knowledge/sources.jsonl` and `claims.jsonl`, **append-only**. Each line is a full record with a `rev` number; the highest `rev` for an id is current. History is therefore never overwritten, "never delete a claim" holds by construction, and "as of <date>" is a replay. A project resolves only through `utils/manifest.ts`; every file write goes through `resolveWithinRoot`.

**Records** (zod, one place: `utils/knowledge/types.ts`):
- Source: `id, project, title, type, origin, captured_at, doc_date, version, hash, authority, is_primary (no|proposed|confirmed), status (current|superseded|withdrawn), supersedes?, superseded_by?, rev`.
- Claim: `id, project, subject, predicate, object, text, source_id, citation, line_start, line_end, doc_date, recorded_at, authority, confidence (0..1), status (agreed|proposed|disputed|superseded|withdrawn), superseded_by?, asserted_by_role?, rev`.
- Authority, highest first: `correction, primary_requirement, approved_plan, tracker_item, wiki_page, accountable_decision, meeting_discussion, chat`.

**Rules (all enforced in code, not in prose):**
1. A claim is rejected unless `validateCitation(claim.citation)` is valid. `line_end >= line_start >= 1`. `source_id` must exist and be `current`.
2. Conflict key is `(subject, predicate)`. Two current claims with different `object`: higher authority wins and the loser is superseded with a pointer; equal authority and a newer `doc_date` wins; still tied means **both** become `disputed` and an open question is raised. Nothing resolves silently, and a lower-authority claim can never override a primary one.
3. Writes are two-step. `plan*` functions return the records and conflicts that *would* be written; `apply*` writes them. Gateway tools take `dryRun` (default `true`).
4. A superseded or disputed claim never appears in `claim_list`/`ask` results unless asked for explicitly, and `check` flags a deliverable that cites one.
5. Cross-project: link, never copy. A link stores `{project, claim_id}` only.

**Surfaces.** `utils/knowledge/*` is the only logic. The gateway server `mcp-servers/knowledge/index.ts` and `scripts/knowledge.ts` (`npm run knowledge -- <cmd>`) are thin and call the same functions. Agents that cannot reach the gateway use the CLI through the terminal.

**No model API, no new dependency.** Retrieval is keyword search in plain TypeScript. Lore is optional and off by default.

## 3. Phases (each ships alone; green bar after each)

Green bar: `npm run typecheck`, `npm test`, `npm run build:prompts -- --check`, `npm run check:conventions` (includes graph and lessons checks), `npm run eval`. Task T00 adds `npm run gate` to run them with a compact summary.

| # | Phase | Scope | Acceptance |
|---|---|---|---|
| 0 | Gate | `npm run gate`: the five commands, one-line-per-check summary, exit code | red on any failure; output fits one screen |
| 1 | Core | types, append-only store, source registry, claim plan/apply, citation + containment | an unsourced claim is rejected; history is never overwritten; tests incl. mutation checks |
| 2 | Currency | supersession, authority ranking, conflict marking, "as of", changes-since report | the conflict matrix below passes; superseded claims never listed by default |
| 3 | Surfaces | gateway server `knowledge`, classification, README/memory docs, CLI | writes default to dry-run; reads classified read; drift check passes |
| 4 | Lexicon | `lexicon.json`, term/forbidden/transcription-fix add and check | a forbidden variant in a file fails `lexicon check` with line numbers |
| 5 | Agents | skill `project-knowledge`, wiring for researcher, test-planner, documenter, reporter, capability evals, one new hard rule | **stop-and-ask before the hard rule and before changing any existing skill's behaviour** |
| 6 | Checks | `check:knowledge` with a ratcheted baseline (`docs/knowledge-baseline.json`, written reasons) | baseline can only shrink; part of `check:conventions` |
| 7 | Cross-project | links, `prior-work` query, no-copy test | a link carries ids only; a copy attempt is refused |
| 8 | Lore adapter | `Retriever` interface, disabled-by-default adapter, fake-server contract tests, push/rebuild | superseded chunk never returned even if Lore still holds it; **real run on the mini-PC is a separate, supervised step** |

Conflict matrix for phase 2 (these are the tests): higher authority beats lower regardless of date; equal authority newer date wins; equal authority and equal date both go `disputed`; a correction beats everything; a withdrawn claim never wins; an unrelated `(subject,predicate)` is untouched.

Behavior evals (one per phase, in `evals/behavior/`, with checks in `evals/behaviorChecks.ts`): `knowledge-rejects-unsourced-claim`, `knowledge-marks-conflict-not-resolves`, `knowledge-superseded-never-in-output`, plus one for the lexicon and one for the Lore adapter staying disabled. Each phase also appends a dated entry to `knowledge/learnings.md`.

## 4. Handoff to a local model (Hermes agent + Gemma ~26B)

**Will it work?** Likely yes for phases 0–2, 4, 6 and 7 (pure TypeScript, small, with a strong automatic check), **if** the work is handed over as small task cards, one per fresh session. It is a risk for phases 3 and 5 and not something to leave unreviewed, and phase 8's real-Lore step needs you. I cannot test Hermes or Gemma from this environment, so the first card is a **pilot**: if it does not pass the gate within three attempts, the cards are too big or the model is not capable enough, and we stop and adjust before spending more.

Design choices that make a smaller model succeed:
- **One task per session, fresh context.** A card names the ≤5 files to read, the exact signatures to write, the named tests, the commands to run, and when to stop. The model does not need to hold the whole repo or this plan in context.
- **The repo is the judge.** `npm run gate` gives pass or fail; the model never decides it is "done" on its own.
- **Tests first, and mutation-check the key ones** (break the code on purpose, see the test fail). This is how real bugs were found earlier in this project.
- **State on disk.** `project-knowledge-layer/STATE.md` holds the next card, the last gate result and any blocker, so a session that dies loses nothing.
- **No judgement-heavy work unreviewed.** Hard-rule wording, skill descriptions and agent specs (phase 5) are drafted by the model but reviewed by you or me before merge.
- **Small diffs.** A card targets under ~200 changed lines; bigger means split the card.
- **Cards are written just in time.** T00–T05 are written now. Each later card is written from the merged code of the card before it, because exact signatures depend on it. Writing them all now would bake in guesses.

What I need to confirm about your setup (cannot see it): the exact model build and context window, quantization, the serving stack (Ollama, llama.cpp, vLLM), whether Hermes can call tools reliably with it, how it edits files and runs commands, and whether it can open pull requests or you will do that.

## 5. Stops (ask before)
A dependency (none planned). Anything outside `mcp-servers/`, `utils/`, `skills/`, `prompts/`, `scripts/`, `evals/`, `docs/`, `knowledge/`, `projects/` (`.gitignore` in T01 is the one known case). Changing an existing hard rule or an existing skill's behaviour. Phase 8 and the Lore data location. Any acceptance criterion that cannot be met as written.

## 6. Never
Hand-edit a generated file; store a claim without a passing citation; resolve a conflict silently; delete a claim; copy one project's content into another; widen a baseline to pass; call a phase done on a red gate or count an unverifiable item as a pass.

## 7. Open questions
1. Is the "one gateway tool server plus a thin CLI over shared code" answer to the MCP conflict acceptable?
2. Confirm "Lore" is only ever used through its retrieval routes (no answer generation).
3. The Hermes and Gemma details listed in section 4.
