# T02: source registry (add, dedupe, supersede), dry-run first

**Goal:** register sources and supersede old versions. Every write has a plan step that writes nothing.

**Branch:** `knowledge/t02-sources`

**Read:** `utils/knowledge/types.ts`, `utils/knowledge/store.ts` (from T01).

**Create:** `utils/knowledge/sources.ts`, `utils/knowledge/sources.test.ts`.

**Signatures:**
```ts
export interface SourceInput { title: string; type: string; origin: string; doc_date: string; version: string; hash: string; authority: Authority; is_primary?: "no" | "proposed" }
export interface SourcePlan { record: Source; duplicateOf?: string; warnings: string[] }
export function planSourceAdd(project: string, input: SourceInput): Promise<SourcePlan>;     // writes nothing
export function applySourceAdd(project: string, plan: SourcePlan): Promise<Source>;           // writes nothing if plan.duplicateOf is set
export interface SupersedePlan { old: Source; next: Source; warnings: string[] }
export function planSupersede(project: string, oldId: string, newId: string): Promise<SupersedePlan>;
export function applySupersede(project: string, plan: SupersedePlan): Promise<void>;         // appends rev+1 for BOTH sources
export function listSources(project: string, opts?: { includeSuperseded?: boolean }): Promise<Source[]>;
```
Rules: id is `S-` + the first 8 hex chars of `hash`; a new source with a hash already registered is a **duplicate**: `duplicateOf` is set and apply writes nothing; a new source starts `status: "current"`, `is_primary: "no"` unless `"proposed"` is passed (never `"confirmed"`: only a person confirms); superseding sets old `status: "superseded"` and `superseded_by`, new `supersedes`; superseding something already superseded, or a source with itself, throws; `warnings` notes when the new `doc_date` is **older** than the old one (do not block).

**Tests first:** plan writes nothing (read the file before and after); apply writes once; duplicate hash is not re-added; `is_primary: "confirmed"` input is rejected; supersede updates both and history keeps the old rev; superseding twice throws; older-date warning present; `listSources` hides superseded by default.

**Mutation check:** make `planSourceAdd` write; the "plan writes nothing" test must fail.

**Done when:** all tests pass under `npm test`; gate green.
