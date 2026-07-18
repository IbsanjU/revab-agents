---
name: simplify
description: Review a target project's changed code for reuse, simplification, and efficiency cleanups — quality only, not bug-hunting (use `code-review` for correctness). Use after automation finishes an implementation, before declaring the task done. Skip for a diff that's pure generated scaffolding with no hand-written logic yet.
---
# Simplify

Improves the quality of already-working changed code — reuse, simplification, efficiency —
without changing behavior. Pairs with `code-review` (correctness) and `verify` (does it work);
this skill only asks "is this the cleanest way to do it."

## Steps
1. Get the diff (`git_diff`/`git_log`, manifest-resolved project; include uncommitted changes).
2. Review for:
   - **Reuse** — new code that reimplements something the target repo (or `revab-agents`'
     own `utils/`, per hard rule 1) already has; name the existing helper to call instead.
   - **Simplification** — redundant/derivable state, copy-paste-with-a-twist, dead code, deep
     nesting; name the simpler form that does the same job.
   - **Efficiency** — redundant computation/I/O, independent calls run sequentially that could
     be parallel, blocking work added to a hot path.
3. Apply each fix directly. Skip (and note why) any finding whose fix would change behavior,
   touch files well outside the reviewed diff, or that looks like a false positive.
4. Re-run the affected scenario (see `verify`) after applying fixes — a simplification pass
   that breaks the feature isn't a simplification.

## Output
Brief summary: what was fixed, what was skipped and why, or confirmation the code was already
clean.
