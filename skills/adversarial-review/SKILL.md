---
name: adversarial-review
description: Get a higher-confidence answer on a high-stakes or contested question by having independent specialists answer separately, a critic challenge them, and the result scored by agreement and source quality. Use when requirements will feed a test plan, when two sources seem to conflict, or when a wrong answer is expensive. Skip for lookups with one obvious, directly cited answer.
---
# Adversarial review

One agent's confident answer is not evidence. This skill is how the orchestrator gets
evidence: independent answers, a challenge, then arithmetic — not a vote by volume.

## When to run it

- A research brief will drive a test plan, a ticket write, or a sign-off.
- Two sources disagree, or a single doc is the only support for a load-bearing claim.
- A previous result failed `review-delegated-work` on accuracy rather than on format.

It costs roughly three times the tokens of one pass, so do not run it for a lookup whose
answer is a single directly cited fact.

## The round

1. **Fix the question.** Write the one question every agent will answer, plus the claim
   keys you expect (short stable ids like `login-lockout-threshold`) so differently
   worded answers group together.
2. **Independent answers, in parallel.** Dispatch the same question to two runs of the
   owning specialist (usually `researcher`) in one turn. Give each the same inputs and
   no view of the other's output — shared context makes them agree by contamination,
   which is not corroboration. Each returns claims as
   `{claim, key, citation, confidence}`.
3. **Challenge.** Dispatch a third run as the critic, with both answers and one job:
   find claims that are wrong, stale, or unsupported. A dispute only counts if it names
   a real source. Tell the critic that "I am not sure" without a source changes nothing.
4. **Score.** Call `consensus_score` with every finding from all three runs (critic
   findings use `stance: "disputes"`). Do not score by eye.
5. **Act on the verdicts.**

| Verdict | Meaning | What you do |
|---|---|---|
| `accepted` | ≥2 agents, sourced, no sourced dispute | Use it. |
| `accepted-with-dissent` | Clears the threshold but a sourced dispute exists | Use it and state the dissent beside it. |
| `contested` | A sourced dispute and support below the threshold | Do not use. Send both sides' sources to the specialist, or ask the user. |
| `single-source` | Only one agent supports it | Use only if flagged as single-sourced; look for a second source. |
| `weak` | Supported but low confidence | Treat as a lead, not a finding. |
| `unsupported` | No valid citation | Drop it. Never repair a missing citation yourself. |

6. **Report the round.** Give the user the accepted claims, then everything not accepted
   with its verdict and the reason. Never fold a contested claim into a clean summary.

## The arithmetic

`score = clamp((Σ support − Σ dispute) / N, 0, 1)`, where each term is
`citation weight × confidence` (system of record = 1, bare URL = 0.6, none/placeholder
= 0) and N is the number of distinct agents in the round. Each agent counts once per
claim. Accepting needs a score of at least 0.6 and at least two supporting agents.

## Rules

- Independence is the point. If the runs saw each other's work, say so and treat the
  agreement as uncorroborated.
- The critic does not edit the answer. It only challenges; the specialist revises.
- A round that ends `contested` is a valid result. Report it; do not run rounds until
  the numbers look good.
- Two agents agreeing on a claim with no source is `unsupported`, not consensus.

## Output

The accepted claims with citations, then a table of the rest (claim, verdict, score,
who supported, who disputed). State how many agents took part and the threshold used.
