import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { checkAll, type Verdict } from './check';
import { loadGraph } from './graph';
import { diffFor, selectClaims } from './select';
import type { Severity } from './types';
import { normalizeRef } from './util';
import { withWorktree } from './worktree';

/**
 * `lore bench`: how far to trust the loop on a real repository (freshness#NOTE-1). Each case edits
 * the code in a throwaway worktree, on purpose to break a claim or to leave it intact, then measures
 * both stages: did selection reach the claim, and what verdict did the check give.
 *
 * The number that matters most is false confirmations: "holds" on a claim the edit broke. A check
 * that says "unsure" costs a person a look; one that says "holds" wrongly lets the break land.
 */
// @lore freshness#NOTE-1

export interface Edit {
  file: string;
  /** Exact text, which must occur exactly once in the file. */
  find: string;
  replace: string;
}

export interface BenchCase {
  id: string;
  ref: string;
  /** `broken`: the edits break the claim. `holds`: they don't (or there are none: a clean control). */
  expect: 'broken' | 'holds';
  edits?: Edit[];
  note?: string;
}

export interface BenchFile {
  /** Paths removed from every worktree before checking, so the agent can't read the answers. */
  hide?: string[];
  cases: BenchCase[];
}

export interface CaseResult {
  id: string;
  ref: string;
  expect: 'broken' | 'holds';
  /** The severity selection gave the claim for this diff, or null if it didn't reach it. */
  selected: Severity | null;
  /** Other claims selection reached at high or medium severity: noise, unless the edit really concerns them. */
  others: string[];
  /** The case changed code (a clean control doesn't). */
  edits: boolean;
  verdict?: Verdict;
  /** `caught`, `missed` (a false confirmation), `alarm` (broken said of a claim that holds), `ok`, `unsure`, or `error` (a bad case, or the agent failed). */
  outcome: 'caught' | 'missed' | 'alarm' | 'ok' | 'unsure' | 'error' | 'unchecked';
  answer?: string;
  error?: string;
  seconds?: number;
}

export interface BenchSummary {
  cases: number;
  broken: number;
  holds: number;
  errors: number;
  /** Broken cases whose claim selection reached at high or medium severity (what `check <range>` checks). */
  selected: number;
  /** Cases with edits, and the other claims their edits reached in all: recall alone would reward selecting everything. */
  edited: number;
  othersReached: number;
  caught: number;
  /** "holds" on a broken claim. */
  falseConfirmations: number;
  /** "broken" on a claim that holds. */
  falseAlarms: number;
  unsure: number;
  /** Broken cases caught by the per-change loop alone: selected, then checked broken. */
  caughtBySelection: number;
}

export function readBench(path: string): BenchFile {
  const data = JSON.parse(readFileSync(path, 'utf8')) as BenchFile | BenchCase[];
  const file = Array.isArray(data) ? { cases: data } : data;
  const ids = new Set<string>();
  for (const c of file.cases) {
    if (!c.id || !c.ref || (c.expect !== 'broken' && c.expect !== 'holds')) throw new Error(`case ${c.id ?? '?'}: needs id, ref and expect (broken|holds)`);
    if (ids.has(c.id)) throw new Error(`case ${c.id}: duplicate id`);
    if (c.expect === 'broken' && !c.edits?.length) throw new Error(`case ${c.id}: a broken case needs edits`);
    ids.add(c.id);
  }
  return file;
}

/** Apply edits to a tree; each `find` must occur exactly once, so a case can't silently go stale. */
export function applyEdits(root: string, edits: Edit[]): void {
  for (const e of edits) {
    const abs = join(root, e.file);
    if (!existsSync(abs)) throw new Error(`${e.file} doesn't exist`);
    const text = readFileSync(abs, 'utf8');
    const at = text.indexOf(e.find);
    if (at < 0) throw new Error(`${e.file}: text to replace not found: ${JSON.stringify(e.find.slice(0, 60))}`);
    if (text.indexOf(e.find, at + 1) >= 0) throw new Error(`${e.file}: text to replace occurs more than once`);
    writeFileSync(abs, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
  }
}

export interface BenchOptions {
  /** Without an agent, only selection is measured (and every case's edits are validated). */
  agent?: string;
  jobs?: number;
  timeoutMs?: number;
  /** The revision each worktree starts from. Default HEAD. */
  rev?: string;
  hide?: string[];
  only?: string[];
  onResult?: (r: CaseResult) => void;
}

function outcomeOf(expect: BenchCase['expect'], verdict: Verdict): CaseResult['outcome'] {
  if (verdict === 'unsure') return 'unsure';
  if (expect === 'broken') return verdict === 'broken' ? 'caught' : 'missed';
  return verdict === 'broken' ? 'alarm' : 'ok';
}

async function runCase(root: string, c: BenchCase, opts: BenchOptions, hide: string[]): Promise<CaseResult> {
  const base: CaseResult = { id: c.id, ref: normalizeRef(c.ref), expect: c.expect, selected: null, others: [], edits: !!c.edits?.length, outcome: 'unchecked' };
  try {
    return await withWorktree(root, opts.rev, async (dir) => {
      applyEdits(dir, c.edits ?? []);
      const graph = loadGraph(dir);
      if (!graph.claims.has(base.ref)) throw new Error(`no claim ${c.ref}`);
      const picked = selectClaims(graph, diffFor(dir, 'HEAD'), { covers: false });
      base.selected = picked.find((r) => normalizeRef(r.ref) === base.ref)?.severity ?? null;
      base.others = picked.filter((r) => normalizeRef(r.ref) !== base.ref && r.severity !== 'low').map((r) => r.ref);
      if (!opts.agent) return base;
      // Selection saw the edits; now take away anything that would give the answer away.
      for (const h of hide) rmSync(join(dir, h), { recursive: true, force: true });
      const started = Date.now();
      const [checked] = await checkAll(loadGraph(dir), [{ ref: base.ref }], { agent: opts.agent, timeoutMs: opts.timeoutMs, jobs: 1 });
      base.seconds = Math.round((Date.now() - started) / 100) / 10;
      base.answer = checked!.answer;
      if (checked!.failed) return { ...base, outcome: 'error' as const, error: `agent failed: ${(checked!.answer ?? '').split('\n').pop()!.slice(0, 200)}` };
      base.verdict = checked!.verdict!;
      base.outcome = outcomeOf(c.expect, base.verdict);
      return base;
    });
  } catch (err) {
    return { ...base, outcome: 'error', error: (err as Error).message };
  }
}

/** Run every case, `jobs` at a time, results in case order. */
export async function bench(root: string, casesPath: string, opts: BenchOptions = {}): Promise<{ results: CaseResult[]; summary: BenchSummary }> {
  const file = readBench(casesPath);
  const rel = relative(resolve(root), resolve(casesPath));
  const inside = !rel.startsWith('..') && !rel.startsWith('/');
  const hide = [...(file.hide ?? []), ...(opts.hide ?? []), ...(inside ? [rel] : [])];
  const cases = opts.only?.length ? file.cases.filter((c) => opts.only!.includes(c.id)) : file.cases;
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(root, cases[i]!, opts, hide);
      opts.onResult?.(results[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.jobs ?? 4) }, worker));
  return { results, summary: summarize(results) };
}

export function summarize(results: CaseResult[]): BenchSummary {
  const ok = results.filter((r) => r.outcome !== 'error');
  const broken = ok.filter((r) => r.expect === 'broken');
  const sel = (r: CaseResult) => r.selected === 'high' || r.selected === 'medium';
  return {
    cases: results.length,
    broken: broken.length,
    holds: ok.length - broken.length,
    errors: results.length - ok.length,
    selected: broken.filter(sel).length,
    edited: ok.filter((r) => r.edits).length,
    othersReached: ok.reduce((n, r) => n + r.others.length, 0),
    caught: ok.filter((r) => r.outcome === 'caught').length,
    falseConfirmations: ok.filter((r) => r.outcome === 'missed').length,
    falseAlarms: ok.filter((r) => r.outcome === 'alarm').length,
    unsure: ok.filter((r) => r.outcome === 'unsure').length,
    caughtBySelection: broken.filter((r) => sel(r) && r.outcome === 'caught').length,
  };
}
