import { rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { applyEdits, expectations, readBench, type BenchCase, type Expected } from './bench';
import { workers } from './check';
import { loadGraph } from './graph';
import { review, type ReviewScope } from './review';
import { assertInside, git, normalizeRef } from './util';
import { withWorktree } from './worktree';

/**
 * `lore bench --review`: score the whole review on each case, as a reviewer would run it on a pull
 * request. A case is a change (edits, or a recorded patch of feature-sized work) and what it does to
 * some invariants; every other invariant is expected not to be broken by it. That measures what the
 * one-claim bench can't: whether triage finds the claim at all, and how much a review cries wolf
 * across the whole graph (cli#NOTE-8).
 */
// @lore cli#DEC-14

export interface ReviewCaseResult {
  id: string;
  expected: Record<string, Expected>;
  /** Expected breaks the review called broken. */
  caught: string[];
  /** Expected breaks it didn't: with the verdict it gave, or `not checked` when triage skipped the claim. */
  missed: { ref: string; got: string }[];
  /** `broken` said of a claim the change was expected not to break. */
  falseAlarms: string[];
  /** `preexisting` verdicts: broken before the change, not counted against it. */
  preexisting: string[];
  unsure: string[];
  /** Invariants checked, and model calls made (triage + checks). */
  checked: number;
  calls: number;
  triageFallback?: boolean;
  error?: string;
  seconds?: number;
}

export interface ReviewBenchSummary {
  cases: number;
  errors: number;
  expectedBreaks: number;
  caught: number;
  /** Of the misses, how many triage never sent to a check. */
  missed: number;
  missedByTriage: number;
  falseAlarms: number;
  preexisting: number;
  unsure: number;
  calls: number;
}

export interface ReviewBenchOptions {
  agent: string;
  scope?: ReviewScope;
  jobs?: number;
  timeoutMs?: number;
  rev?: string;
  hide?: string[];
  only?: string[];
  onResult?: (r: ReviewCaseResult) => void;
}

async function runReviewCase(root: string, casesDir: string, c: BenchCase, opts: ReviewBenchOptions, hide: string[], rev?: string): Promise<ReviewCaseResult> {
  const expected = expectations(c);
  const base: ReviewCaseResult = { id: c.id, expected, caught: [], missed: [], falseAlarms: [], preexisting: [], unsure: [], checked: 0, calls: 0 };
  try {
    return await withWorktree(root, rev, async (dir) => {
      // Hidden files go first, in a commit of their own: deleted after the change, they would be in
      // the diff the review reads, answers and all.
      for (const h of hide) rmSync(join(dir, h), { recursive: true, force: true });
      if (git(dir, ['status', '--porcelain'])) {
        git(dir, ['add', '-A']);
        git(dir, ['-c', 'user.name=lore', '-c', 'user.email=lore@localhost', 'commit', '-q', '--no-verify', '-m', 'bench: hide answers']);
      }
      applyEdits(dir, c.edits ?? []);
      // --index, so new files the patch adds are part of the diff the review reads.
      if (c.patch) git(dir, ['apply', '--index', resolve(casesDir, c.patch)]);
      const started = Date.now();
      const r = await review(loadGraph(dir), { range: 'HEAD', agent: opts.agent, scope: opts.scope, jobs: 2, timeoutMs: opts.timeoutMs });
      base.seconds = Math.round((Date.now() - started) / 100) / 10;
      const verdict = new Map(r.items.filter((i) => i.checked).map((i) => [normalizeRef(i.ref), i.verdict ?? 'unsure']));
      for (const [ref, want] of Object.entries(expected)) {
        const got = verdict.get(ref);
        if (want === 'broken') got === 'broken' ? base.caught.push(ref) : base.missed.push({ ref, got: got ?? 'not checked' });
        else if (want === 'holds' && got === 'broken') base.falseAlarms.push(ref);
      }
      for (const [ref, got] of verdict) {
        if (expected[ref]) continue;
        if (got === 'broken') base.falseAlarms.push(ref);
        else if (got === 'preexisting') base.preexisting.push(ref);
        else if (got === 'unsure') base.unsure.push(ref);
      }
      return { ...base, checked: verdict.size, calls: r.calls, ...(r.triageFallback ? { triageFallback: true } : {}) };
    });
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

export async function benchReview(root: string, casesPath: string, opts: ReviewBenchOptions): Promise<{ results: ReviewCaseResult[]; summary: ReviewBenchSummary }> {
  const file = readBench(casesPath);
  const rel = relative(resolve(root), resolve(casesPath));
  const inside = !rel.startsWith('..') && !rel.startsWith('/');
  const hide = [...(file.hide ?? []), ...(opts.hide ?? []), ...(inside ? [rel] : [])];
  for (const h of hide) assertInside(h);
  const cases = opts.only?.length ? file.cases.filter((c) => opts.only!.includes(c.id)) : file.cases;
  const results: ReviewCaseResult[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runReviewCase(root, dirname(resolve(casesPath)), cases[i]!, opts, hide, opts.rev ?? file.rev);
      opts.onResult?.(results[i]!);
    }
  };
  // Each case runs its own checks two at a time, so cases run at a quarter of --jobs.
  await Promise.all(Array.from({ length: Math.max(1, Math.floor(workers(opts.jobs) / 2)) }, worker));
  return { results, summary: summarizeReview(results) };
}

export function summarizeReview(results: ReviewCaseResult[]): ReviewBenchSummary {
  const ok = results.filter((r) => !r.error);
  const sum = (f: (r: ReviewCaseResult) => number) => ok.reduce((n, r) => n + f(r), 0);
  return {
    cases: results.length,
    errors: results.length - ok.length,
    expectedBreaks: sum((r) => Object.values(r.expected).filter((e) => e === 'broken').length),
    caught: sum((r) => r.caught.length),
    missed: sum((r) => r.missed.length),
    missedByTriage: sum((r) => r.missed.filter((m) => m.got === 'not checked').length),
    falseAlarms: sum((r) => r.falseAlarms.length),
    preexisting: sum((r) => r.preexisting.length),
    unsure: sum((r) => r.unsure.length),
    calls: sum((r) => r.calls),
  };
}

export function reviewBenchText(results: ReviewCaseResult[], s: ReviewBenchSummary): string {
  const cell = (xs: string[]) => xs.join(', ') || '–';
  const rows = results.map((r) =>
    r.error
      ? `| ${r.id} | error: ${r.error.replace(/\|/g, '\\|').slice(0, 120)} | | | | | |`
      : `| ${r.id} | ${cell(Object.entries(r.expected).filter(([, e]) => e === 'broken').map(([k]) => k))} | ${cell(r.caught)} | ${cell(r.missed.map((m) => `${m.ref} (${m.got})`))} | ${cell(r.falseAlarms)} | ${cell(r.preexisting)} | ${r.calls} |`,
  );
  return [
    '| Case | Expected broken | Caught | Missed | False alarms | Already broken | Calls |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `${s.cases} cases${s.errors ? `, ${s.errors} errors` : ''}: caught ${s.caught} of ${s.expectedBreaks} expected breaks; missed ${s.missed}${s.missed ? ` (${s.missedByTriage} never checked: triage skipped them)` : ''}`,
    `false alarms ${s.falseAlarms}, already broken ${s.preexisting}, unsure ${s.unsure}; ${s.calls} model calls`,
    '',
  ].join('\n');
}
