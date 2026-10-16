import { checkAll, prepare, sweepTargets, type CheckRecord } from './check';
import { trace } from './query';
import { diffFor, selectClaims } from './select';
import type { ClaimRecord, Graph, Severity } from './types';
import { normalizeRef } from './util';

/**
 * `lore review`: what a change could break, and whether it does (SPEC.md §8). One call for a
 * reviewing agent: the claims the change reaches and why, what rests on each, and verdicts.
 *
 * Invariants are checked; decisions and notes the change reaches are listed as context, since
 * decision checks wait for a benchmark (freshness#DEC-11). When the graph has at most `max`
 * active invariants, every one is checked, because selection misses callers and other files.
 */
// @lore cli#DEC-11, layers#DEC-7

export interface ReviewItem extends Omit<ClaimRecord, 'severity'> {
  /** The severity selection gave it for this change; null for an invariant checked only because the graph is small. */
  severity: Severity | null;
  reasons: string[];
  /** What rests on it: claims a trace down reaches, with how. */
  downstream: { ref: string; via: string; statement: string }[];
  /** Whether a verdict was (or, without an agent, should be) asked for. */
  checked: boolean;
  question?: string;
  prompt?: string;
  verdict?: CheckRecord['verdict'];
  answer?: string;
  failed?: boolean;
}

export interface Review {
  range: string;
  /** `all`: every active invariant is checked; `selected`: only what the change reaches. */
  scope: 'all' | 'selected';
  invariants: number;
  items: ReviewItem[];
}

export interface ReviewOptions {
  range?: string;
  staged?: boolean;
  /** Check every active invariant up to this many (default 50); above it, only selected ones. */
  max?: number;
  /** Only check what selection reaches, whatever the graph's size. */
  selectedOnly?: boolean;
  /** Hops of downstream claims to list (default 1). */
  depth?: number;
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** The review without verdicts: deterministic, no model (what an agent that is itself the model answers). */
export function reviewContext(graph: Graph, opts: ReviewOptions = {}): Review {
  const range = opts.staged ? 'staged' : (opts.range ?? 'HEAD');
  const picked = selectClaims(graph, diffFor(graph.root, opts.range, opts.staged), { covers: false }).filter((r) => r.severity !== 'low');
  const invariants = sweepTargets(graph);
  const scope = !opts.selectedOnly && invariants.length <= (opts.max ?? 50) ? 'all' : 'selected';
  const items = new Map<string, ReviewItem>();
  const add = (ref: string, severity: Severity | null, reasons: string[]) => {
    const c = graph.claims.get(normalizeRef(ref))!;
    const downstream = severity
      ? trace(graph, [c.ref], { direction: 'down', depth: opts.depth ?? 1 }).rows
          .filter((r) => r.hop > 0)
          .map((r) => ({ ref: r.ref, via: r.via, statement: r.statement }))
      : [];
    const checked = c.kind === 'INV' && (scope === 'all' || severity !== null);
    items.set(normalizeRef(c.ref), { ref: c.ref, kind: c.kind, statement: c.statement, severity, reasons, downstream, checked });
  };
  for (const r of [...picked].sort((a, b) => RANK[a.severity!] - RANK[b.severity!])) add(r.ref, r.severity!, r.reasons ?? []);
  if (scope === 'all') for (const r of invariants) if (!items.has(normalizeRef(r.ref))) add(r.ref, null, []);
  const prepared = new Map(prepare(graph, [...items.values()].filter((i) => i.checked)).map((p) => [normalizeRef(p.ref), p]));
  for (const [key, item] of items) {
    const p = prepared.get(key);
    if (p) Object.assign(item, { question: p.question, prompt: p.prompt });
  }
  return { range, scope, invariants: invariants.length, items: [...items.values()] };
}

/** The review with a verdict for every checked claim, `jobs` checks at a time. */
export async function review(
  graph: Graph,
  opts: ReviewOptions & { agent: string; jobs?: number; timeoutMs?: number; onResult?: (r: CheckRecord) => void },
): Promise<Review> {
  const ctx = reviewContext(graph, opts);
  const todo = ctx.items.filter((i) => i.checked);
  const results = await checkAll(graph, todo, { agent: opts.agent, jobs: opts.jobs, timeoutMs: opts.timeoutMs, onResult: opts.onResult });
  const byRef = new Map(results.map((r) => [normalizeRef(r.ref), r]));
  for (const item of ctx.items) {
    const r = byRef.get(normalizeRef(item.ref));
    if (r) Object.assign(item, { verdict: r.verdict, answer: r.answer, ...(r.failed ? { failed: true } : {}) });
  }
  return ctx;
}

const MARK: Record<string, string> = { holds: '✓ holds', broken: '✗ broken', unsure: '? unsure' };

/** A review as markdown, for a PR comment or a person: reached claims in full, the rest summarized. */
export function reviewText(r: Review, withVerdicts: boolean): string {
  const reached = r.items.filter((i) => i.severity);
  const others = r.items.filter((i) => !i.severity);
  const out: string[] = [`## Lore review: ${r.range}`, ''];
  const scope =
    r.scope === 'all'
      ? `every invariant is checked (${r.invariants}, few enough to afford)`
      : `only reached invariants are checked (${r.invariants} in the graph; a sweep covers the rest)`;
  out.push(`${reached.length ? `The change reaches ${reached.length} claim${reached.length === 1 ? '' : 's'}` : 'The change reaches no claim'}; ${scope}.`, '');
  for (const i of reached) {
    const head = withVerdicts && i.checked ? `${MARK[i.verdict ?? 'unsure']}: ` : '';
    out.push(`### ${head}${i.ref} (${i.kind}, ${i.severity})`, '', i.statement, '');
    if (i.reasons.length) out.push(`- **Reached:** ${i.reasons.join('; ')}`);
    if (i.downstream.length) out.push(`- **Rests on it:** ${i.downstream.map((d) => `${d.ref} (${d.via})`).join('; ')}`);
    if (!i.checked) out.push(`- **Not checked:** a ${i.kind === 'DEC' ? 'decision: keep to it, or don\'t propose what it rejected without new evidence' : 'note: take it into account'}`);
    else if (!withVerdicts) out.push(`- **Ask:** ${i.question}`);
    if (withVerdicts && i.answer) out.push('', ...i.answer.split('\n').slice(1).join('\n').trim().split('\n').map((l) => `> ${l}`));
    out.push('');
  }
  if (others.length) {
    if (withVerdicts) {
      const bad = others.filter((i) => i.verdict !== 'holds');
      const holds = others.length - bad.length;
      out.push(`### Not reached by the change: ${holds} of ${others.length} invariants hold`, '');
      for (const i of bad) {
        out.push(`- ${MARK[i.verdict ?? 'unsure']}: **${i.ref}**: ${i.statement}`);
        const why = (i.answer ?? '').split('\n').slice(1).join(' ').trim().slice(0, 400);
        if (why) out.push(`  > ${why}`);
      }
    } else {
      out.push(`### Also check (not reached by the change)`, '', others.map((i) => i.ref).join(', '));
    }
    out.push('');
  }
  if (withVerdicts) {
    const held = r.items.filter((i) => i.checked && i.verdict === 'holds').map((i) => i.ref);
    if (held.length) out.push('```', `Lore-Verified: ${held.join(', ')}`, '```', '');
  }
  return out.join('\n');
}
