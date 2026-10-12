/**
 * Consensus scoring — the arithmetic behind `adversarial-review`.
 *
 * When several agents answer the same question, "they agree" is not evidence by
 * itself: three agents can repeat one wrong claim, and a confident dissent with no
 * source is just noise. This module turns independent findings into a score using
 * two rules, both stated so a reviewer can check the math by hand:
 *
 *  1. Only a sourced finding counts. A finding's weight is the quality of its
 *     citation (see `citation.ts`): a system-of-record source (Jira, Confluence,
 *     JTMF, app-model, transcript, repo file) weighs 1, a bare URL weighs 0.6, and a
 *     missing or placeholder citation weighs 0 — for support AND for dispute. A
 *     critic who says "I doubt this" without naming a source does not move the score.
 *  2. Each agent counts once per claim (its strongest finding), so repeating a claim
 *     cannot inflate it.
 *
 * score(claim) = clamp( (Σ support − Σ dispute) / N , 0, 1 )
 *
 * where each term is `weight × confidence` (confidence defaults to 1) and N is the
 * number of distinct agents that took part in the round. Corroboration needs at least
 * two distinct supporting agents, so one agent's confident answer never reaches
 * "accepted" on its own, however well it is cited.
 */
import { validateCitation } from "./citation.js";

export type Stance = "supports" | "disputes";

export interface Finding {
  /** Which agent (or independent run) produced this finding. */
  agent: string;
  /** The claim in the agent's words. Used to derive `key` when none is given. */
  claim: string;
  /** Stable id so differently-worded findings about the same fact group together. */
  key?: string;
  /** Source for the claim, in a form `validateCitation` accepts. */
  citation?: string;
  /** 0–1, how sure the agent says it is. Defaults to 1. */
  confidence?: number;
  /** Defaults to "supports". A critic's challenge is a "disputes" finding. */
  stance?: Stance;
}

export type Verdict =
  | "accepted"
  | "accepted-with-dissent"
  | "contested"
  | "single-source"
  | "weak"
  | "unsupported";

export interface ClaimResult {
  key: string;
  claim: string;
  score: number;
  verdict: Verdict;
  supporters: string[];
  disputers: string[];
  supportWeight: number;
  disputeWeight: number;
}

export interface ConsensusReport {
  agents: number;
  threshold: number;
  claims: ClaimResult[];
}

export interface ConsensusOptions {
  /** Score needed (with ≥2 supporters) to accept a claim. Default 0.6. */
  threshold?: number;
}

const URL_WEIGHT = 0.6;

/** Quality of a citation as evidence: 1 system of record, 0.6 bare URL, 0 otherwise. */
export function citationWeight(citation: string | undefined): number {
  const result = validateCitation(citation);
  if (!result.valid || result.citations.length === 0) return 0;
  return result.citations.some((c) => c.kind !== "url") ? 1 : URL_WEIGHT;
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function scoreConsensus(findings: Finding[], options: ConsensusOptions = {}): ConsensusReport {
  const threshold = options.threshold ?? 0.6;
  const agents = new Set(findings.map((f) => f.agent));
  const n = agents.size;

  interface Bucket {
    claim: string;
    support: Map<string, number>;
    dispute: Map<string, number>;
  }
  const buckets = new Map<string, Bucket>();

  for (const f of findings) {
    const key = f.key ?? normalizeKey(f.claim);
    const bucket = buckets.get(key) ?? { claim: f.claim, support: new Map(), dispute: new Map() };
    const weight = citationWeight(f.citation) * clamp01(f.confidence ?? 1);
    const side = (f.stance ?? "supports") === "supports" ? bucket.support : bucket.dispute;
    // One vote per agent per claim: keep the strongest.
    side.set(f.agent, Math.max(side.get(f.agent) ?? 0, weight));
    // A supporter's wording is the canonical claim text; a critic's is not.
    if ((f.stance ?? "supports") === "supports" && bucket.support.size === 1) bucket.claim = f.claim;
    buckets.set(key, bucket);
  }

  const claims: ClaimResult[] = [];
  for (const [key, b] of buckets) {
    const supportWeight = [...b.support.values()].reduce((a, w) => a + w, 0);
    const disputeWeight = [...b.dispute.values()].reduce((a, w) => a + w, 0);
    const supporters = [...b.support.entries()].filter(([, w]) => w > 0).map(([a]) => a);
    const disputers = [...b.dispute.entries()].filter(([, w]) => w > 0).map(([a]) => a);
    const score = n === 0 ? 0 : clamp01((supportWeight - disputeWeight) / n);

    let verdict: Verdict;
    if (supporters.length === 0) verdict = "unsupported";
    else if (supporters.length >= 2 && score >= threshold) {
      verdict = disputers.length > 0 ? "accepted-with-dissent" : "accepted";
    } else if (disputers.length > 0) verdict = "contested";
    else if (supporters.length === 1) verdict = "single-source";
    else verdict = "weak";

    claims.push({
      key,
      claim: b.claim,
      score: round(score),
      verdict,
      supporters,
      disputers,
      supportWeight: round(supportWeight),
      disputeWeight: round(disputeWeight),
    });
  }

  claims.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return { agents: n, threshold, claims };
}
