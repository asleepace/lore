import { promptFor, runAgent, sweepTargets, workers, type CheckRecord, type Verdict } from './check';
import { questionFor } from './ask';
import { trace } from './query';
import { diffText, parseDiff as parseDiffText, selectClaims } from './select';
import type { ClaimRecord, Graph, Severity } from './types';
import { normalizeRef, REF_RX } from './util';

/**
 * `lore review`: what a change could break, and whether it does (SPEC.md §8). One call for a
 * reviewing agent: the claims the change reaches and why, what rests on each, and verdicts about
 * the change.
 *
 * Which invariants get a check: the ones selection reaches (deterministic), plus the ones a triage
 * call flags after reading the diff beside every invariant (the default: one model call sees the
 * whole graph against the change, so a break in a new code path no marker covers is still found),
 * or every invariant (`all`), or only the selected ones (`selected`). Each check gets the diff and
 * judges the change: holds, broken, preexisting (broken before, not made worse) or unsure.
 * Decisions and notes the change reaches are context, since decision checks wait for a benchmark
 * (freshness#DEC-11).
 */
// @lore cli#DEC-11, cli#DEC-13, layers#DEC-8

export type ReviewScope = 'triage' | 'all' | 'selected';

export interface ReviewItem extends Omit<ClaimRecord, 'severity'> {
  /** The severity selection gave it for this change; null when it wasn't selected. */
  severity: Severity | null;
  reasons: string[];
  /** Why triage flagged it, when it did. */
  triage?: string;
  /** What rests on it: claims a trace down reaches, with how. */
  downstream: { ref: string; via: string; statement: string }[];
  /** Whether a verdict was (or, without an agent, should be) asked for. */
  checked: boolean;
  question?: string;
  prompt?: string;
  verdict?: Verdict;
  answer?: string;
  failed?: boolean;
}

export interface Review {
  range: string;
  scope: ReviewScope;
  /** Active invariants in the graph. */
  invariants: number;
  /** Model calls made: one for triage (if any), one per check. */
  calls: number;
  /** Triage failed or answered nothing parseable, so every invariant was checked instead. */
  triageFallback?: boolean;
  items: ReviewItem[];
}

export interface ReviewOptions {
  range?: string;
  staged?: boolean;
  /** Which invariants to check (default `triage` with an agent, `all` without). */
  scope?: ReviewScope;
  /** Hops of downstream claims to list (default 1). */
  depth?: number;
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const MAX_TRIAGE_DIFF = 40_000;

/** The triage prompt: the diff, then every active invariant with the guarantee it protects. */
export function triagePrompt(graph: Graph, diff: string): string {
  const lines = sweepTargets(graph).map(({ ref }) => {
    const c = graph.claims.get(normalizeRef(ref))!;
    const why = c.rationale[0] ? ` Why: ${c.rationale[0].replace(/\s+/g, ' ').slice(0, 300)}` : '';
    return `- ${c.ref}: ${c.statement}${why}`;
  });
  const d = diff.length > MAX_TRIAGE_DIFF ? diff.slice(0, MAX_TRIAGE_DIFF) + '\n[diff truncated]\n' : diff;
  return [
    'You are triaging a code change against the invariants of this repository: rules that must always hold, each with the reason it exists.',
    '',
    'The change (git diff; you may read the repository for more context):',
    '',
    '```diff',
    d.trimEnd(),
    '```',
    '',
    'Invariants:',
    ...lines,
    '',
    'List every invariant this change could break or weaken, including through a code path it adds that no existing check covers, or by changing what something means without changing its shape. Err toward listing: each one you list gets a careful check, and one you leave out gets none.',
    'Answer with one line per invariant, `AFFECTS: <ref>: <one-sentence reason>`, or the single line `AFFECTS: none`.',
  ].join('\n');
}

/** Refs and reasons from a triage answer; null if it said nothing usable. */
export function parseTriage(answer: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let none = false;
  for (const line of answer.split('\n')) {
    const m = /^\W*AFFECTS:\s*(.*)$/i.exec(line.trim());
    if (!m) continue;
    if (/^none\b/i.test(m[1]!.trim())) none = true;
    const ref = m[1]!.match(REF_RX)?.[0];
    if (ref) out.set(normalizeRef(ref), m[1]!.slice(m[1]!.indexOf(ref) + ref.length).replace(/^[\s:—-]+/, '').trim());
  }
  return out.size || none ? out : null;
}

/** The review without verdicts: deterministic, no model. Without triage, every invariant is listed to check. */
export function reviewContext(graph: Graph, opts: ReviewOptions = {}): Review & { diff: string } {
  const range = opts.staged ? 'staged' : (opts.range ?? 'HEAD');
  const diff = diffText(graph.root, opts.range, opts.staged, 3);
  const picked = selectClaims(graph, parseDiffOf(graph, opts), { covers: false }).filter((r) => r.severity !== 'low');
  const invariants = sweepTargets(graph);
  const scope = opts.scope ?? 'all';
  const items = new Map<string, ReviewItem>();
  for (const r of [...picked].sort((a, b) => RANK[a.severity!] - RANK[b.severity!])) addItem(graph, items, r.ref, r.severity!, r.reasons ?? [], opts);
  // Without a model, `triage` can't run here: the caller (an agent) gets every invariant to judge.
  if (scope !== 'selected') for (const r of invariants) addItem(graph, items, r.ref, null, [], opts);
  const review = { range, scope, invariants: invariants.length, calls: 0, items: [...items.values()], diff };
  for (const i of review.items) if (i.checked) fillPrompt(graph, i, diff);
  return review;
}

function parseDiffOf(graph: Graph, opts: ReviewOptions) {
  // Selection reads the zero-context diff; the prompts get one with context.
  return parseDiffText(diffText(graph.root, opts.range, opts.staged, 0));
}

function addItem(graph: Graph, items: Map<string, ReviewItem>, ref: string, severity: Severity | null, reasons: string[], opts: ReviewOptions, why?: string) {
  const key = normalizeRef(ref);
  const existing = items.get(key);
  if (existing) {
    if (why) existing.triage = why;
    return;
  }
  const c = graph.claims.get(key);
  if (!c) return;
  const downstream = severity
    ? trace(graph, [c.ref], { direction: 'down', depth: opts.depth ?? 1 }).rows
        .filter((r) => r.hop > 0)
        .map((r) => ({ ref: r.ref, via: r.via, statement: r.statement }))
    : [];
  items.set(key, { ref: c.ref, kind: c.kind, statement: c.statement, severity, reasons, downstream, checked: c.kind === 'INV', ...(why ? { triage: why } : {}) });
}

function fillPrompt(graph: Graph, item: ReviewItem, diff: string) {
  const c = graph.claims.get(normalizeRef(item.ref))!;
  const why = [item.reasons.length ? `selected: ${item.reasons.join('; ')}` : '', item.triage ? `triage: ${item.triage}` : ''].filter(Boolean).join('. ');
  Object.assign(item, { question: questionFor(c), prompt: promptFor(graph, c, { diff, why: why || undefined }) });
}

/** The review with verdicts: triage (by default), then a check of every candidate against the change. */
export async function review(
  graph: Graph,
  opts: ReviewOptions & { agent: string; jobs?: number; timeoutMs?: number; onResult?: (r: ReviewItem) => void },
): Promise<Review> {
  const scope = opts.scope ?? 'triage';
  const range = opts.staged ? 'staged' : (opts.range ?? 'HEAD');
  const diff = diffText(graph.root, opts.range, opts.staged, 3);
  const picked = selectClaims(graph, parseDiffOf(graph, opts), { covers: false }).filter((r) => r.severity !== 'low');
  const invariants = sweepTargets(graph);
  const items = new Map<string, ReviewItem>();
  for (const r of [...picked].sort((a, b) => RANK[a.severity!] - RANK[b.severity!])) addItem(graph, items, r.ref, r.severity!, r.reasons ?? [], opts);
  let calls = 0;
  let triageFallback = false;
  if (scope === 'all') {
    for (const r of invariants) addItem(graph, items, r.ref, null, [], opts);
  } else if (scope === 'triage' && diff.trim()) {
    calls++;
    const t = await runAgent(graph.root, triagePrompt(graph, diff), { agent: opts.agent, timeoutMs: opts.timeoutMs });
    const flagged = t.failed ? null : parseTriage(t.answer);
    if (!flagged) {
      // A triage that failed must not turn into "nothing to check".
      triageFallback = true;
      for (const r of invariants) addItem(graph, items, r.ref, null, [], opts);
    } else {
      for (const [ref, why] of flagged) if (graph.claims.get(ref)?.kind === 'INV' && graph.claims.get(ref)?.active) addItem(graph, items, ref, null, [], opts, why || 'flagged by triage');
    }
  }
  const list = [...items.values()];
  for (const i of list) if (i.checked) fillPrompt(graph, i, diff);
  const todo = list.filter((i) => i.checked);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const item = todo[next++]!;
      const r = await runAgent(graph.root, item.prompt!, { agent: opts.agent, timeoutMs: opts.timeoutMs });
      Object.assign(item, { verdict: r.verdict, answer: r.answer, ...(r.failed ? { failed: true } : {}) });
      opts.onResult?.(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers(opts.jobs), Math.max(1, todo.length)) }, worker));
  calls += todo.length;
  return { range, scope, invariants: invariants.length, calls, ...(triageFallback ? { triageFallback } : {}), items: list };
}

const MARK: Record<string, string> = { holds: '✓ holds', broken: '✗ broken', preexisting: '◦ already broken', unsure: '? unsure' };

/** A review as markdown, for a PR comment or a person: reached and flagged claims in full, the rest summarized. */
export function reviewText(r: Review, withVerdicts: boolean): string {
  const shown = r.items.filter((i) => i.severity || i.triage || (withVerdicts && i.checked && i.verdict !== 'holds'));
  const rest = r.items.filter((i) => !shown.includes(i));
  const out: string[] = [`## Lore review: ${r.range}`, ''];
  const flagged = r.items.filter((i) => i.triage).length;
  const reached = r.items.filter((i) => i.severity).length;
  const how =
    r.scope === 'triage'
      ? r.triageFallback
        ? `triage failed, so every invariant (${r.invariants}) was checked against the change`
        : `triage read the change against all ${r.invariants} invariants and flagged ${flagged}`
      : r.scope === 'all'
        ? `every invariant (${r.invariants}) is checked against the change`
        : `only reached invariants are checked`;
  out.push(`${reached ? `The change reaches ${reached} claim${reached === 1 ? '' : 's'}` : 'The change reaches no claim'}; ${how}.`, '');
  for (const i of shown) {
    const head = withVerdicts && i.checked ? `${MARK[i.verdict ?? 'unsure']}: ` : '';
    out.push(`### ${head}${i.ref} (${i.kind}${i.severity ? `, ${i.severity}` : ''})`, '', i.statement, '');
    if (i.reasons.length) out.push(`- **Reached:** ${i.reasons.join('; ')}`);
    if (i.triage) out.push(`- **Flagged by triage:** ${i.triage}`);
    if (i.downstream.length) out.push(`- **Rests on it:** ${i.downstream.map((d) => `${d.ref} (${d.via})`).join('; ')}`);
    if (!i.checked) out.push(`- **Not checked:** a ${i.kind === 'DEC' ? "decision: keep to it, or don't propose what it rejected without new evidence" : 'note: take it into account'}`);
    else if (!withVerdicts) out.push(`- **Ask:** does this change break it? (prompt in --json)`);
    if (withVerdicts && i.answer) out.push('', ...i.answer.split('\n').slice(1).join('\n').trim().split('\n').map((l) => `> ${l}`));
    out.push('');
  }
  if (rest.length) {
    if (withVerdicts) out.push(`### Checked against the change and holding: ${rest.filter((i) => i.checked).map((i) => i.ref).join(', ') || 'none'}`, '');
    else out.push(`### Also check against the change`, '', rest.map((i) => i.ref).join(', '), '');
  }
  if (withVerdicts) {
    const unchecked = r.invariants - r.items.filter((i) => i.checked).length;
    if (r.scope === 'triage' && unchecked > 0) out.push(`${unchecked} invariant${unchecked === 1 ? '' : 's'} not flagged by triage, so not checked.`, '');
    const held = r.items.filter((i) => i.checked && i.verdict === 'holds').map((i) => i.ref);
    if (held.length) out.push('```', `Lore-Verified: ${held.join(', ')}`, '```', '');
  }
  return out.join('\n');
}

export type { CheckRecord };
