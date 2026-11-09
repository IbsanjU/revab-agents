# T00: `npm run gate` (pilot card)

**Goal:** one command that runs the repo's five checks and prints a short summary, so a model (or a person) can see pass or fail without reading hundreds of lines.

**Branch:** `knowledge/t00-gate`

**Read:** `package.json` (scripts), `scripts/run-evals.ts` (for style only).

**Create:** `scripts/gate.ts`, `scripts/gate.test.ts`. **Edit:** `package.json` (add `"gate": "tsx scripts/gate.ts"`).

**Signatures (write exactly these):**
```ts
export interface GateStep { name: string; command: string }
export interface StepResult { name: string; ok: boolean; seconds: number; tail: string }
export type Runner = (command: string) => { status: number | null; output: string };
export const GATE_STEPS: GateStep[];                 // see list below
export function runGate(steps: GateStep[], run: Runner, now?: () => number): StepResult[];
export function formatSummary(results: StepResult[]): string;   // one line per step; failed steps add the last 20 lines of output
```
`GATE_STEPS` in order: `typecheck` → `npm run typecheck`; `test` → `npm test`; `prompts` → `npm run build:prompts -- --check`; `conventions` → `npm run check:conventions`; `eval` → `npm run eval`.
The default runner uses `spawnSync(command, { shell: true, encoding: "utf8" })` (works on Windows) and combines stdout and stderr. The script runs **every** step even after a failure, prints `formatSummary`, and exits 1 if any failed.

**Tests to write first (`scripts/gate.test.ts`, use a fake `Runner`, never the real commands):**
1. all steps pass: every result `ok`, summary has one line per step.
2. a failing step is reported `ok: false` and the following steps still run.
3. `formatSummary` of a failure includes only the last 20 lines of its output.
4. a step whose `status` is `null` (killed) counts as failed.
5. `GATE_STEPS` names are exactly `typecheck, test, prompts, conventions, eval`, in that order.

**Mutation check:** change `ok` to ignore `status === null` and confirm test 4 fails; restore.

**Done when:** the five tests pass; `npm run gate` runs and prints five lines; `npm run gate` is green on master; `npm run typecheck` and `npm run check:conventions` are green.

**Stop and report if:** `scripts/*.test.ts` is not matched by the `test` script glob (it is: `scripts/*.test.ts`); anything in `package.json` besides the new script needs changing.

**Pilot note:** this card measures whether the setup works. If you cannot finish it within three gate attempts, say so plainly in the report. That is a useful result, not a failure.
