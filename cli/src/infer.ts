import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, snippet } from './check';
import type { Claim, Graph, Kind } from './types';
import { normalizeRef, repoFiles } from './util';
import { withWorktree } from './worktree';

/**
 * `lore infer`: which claims could an agent have worked out from the code alone (SPEC.md §10)?
 * A claim the code reproduces restates it (principle 1): a candidate to cut or rewrite. A claim it
 * misses is what the graph adds.
 *
 * Two steps per claim. **Blind**: in a throwaway worktree with the graph deleted and markers
 * stripped, an agent sees the code where the claim is anchored and answers a question for its kind,
 * never the claim's own question, which would hand it the answer. **Grade**: a second call compares
 * the blind answer with the claim.
 */
// @lore cli#DEC-12

export type Located = 'code' | 'files' | 'tests' | 'covers' | 'topic';
export type InferVerdict = 'inferred' | 'partial' | 'missed' | 'unsure';

export interface InferResult {
  ref: string;
  kind: Kind;
  statement: string;
  /** What the blind agent was pointed at: marked code, `files:`, `tests:`, the node's `covers`, or only its title. */
  located: Located;
  blindPrompt: string;
  blind?: string;
  /** The least inferable verdict across runs: a claim counts as inferred only if every run inferred it. */
  verdict?: InferVerdict;
  grade?: string;
  /** Each run's verdict, when there was more than one. */
  runs?: InferVerdict[];
  failed?: boolean;
}

export interface InferSummary {
  claims: number;
  byKind: Record<Kind, Record<InferVerdict, number>>;
  inferred: string[];
  partial: string[];
}

const BLIND_QUESTION: Record<Kind, string> = {
  INV: 'What property must this code always preserve, so that breaking it would be a bug? State it as one rule, as specifically as the code allows.',
  DEC: 'What design choice does this code reflect, what alternative might someone propose instead, and why was that alternative not taken?',
  NOTE: 'What about how this code behaves would surprise someone working on it: a limit, a quirk, or how it meets another part of the system?',
};

const KIND_NAME: Record<Kind, string> = { INV: 'an invariant', DEC: 'a decision', NOTE: 'a note' };

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Where to point the blind agent, from most to least specific, without any of the graph's text. */
function locate(graph: Graph, c: Claim, dir: string): { located: Located; where: string } {
  const ref = normalizeRef(c.ref);
  const regions = graph.markers
    .filter((m) => m.ref === ref && m.verb === 'upholds')
    .map((m) => snippet(dir, m.file, m.line, m.endLine))
    .filter((s): s is string => !!s);
  if (regions.length) return { located: 'code', where: ['Code:', '', ...regions].join('\n') };
  if (list(c.meta.files).length) return { located: 'files', where: `Files: ${list(c.meta.files).join(', ')}` };
  if (list(c.meta.tests).length) return { located: 'tests', where: `Tests: ${list(c.meta.tests).join(', ')}` };
  const covers = graph.nodes.get(c.node)!.frontmatter.covers;
  const globs = Array.isArray(covers) ? (covers as string[]) : typeof covers === 'string' ? [covers] : [];
  if (globs.length) return { located: 'covers', where: `The code is in: ${globs.join(', ')}` };
  return { located: 'topic', where: `The area: ${graph.nodes.get(c.node)!.title}` };
}

/** The blind prompt: the location and a question for the claim's kind. Deterministic. */
export function blindPrompt(graph: Graph, c: Claim, dir: string): { located: Located; prompt: string } {
  const { located, where } = locate(graph, c, dir);
  const prompt = [
    'You are reading this repository for the first time. Look at the code below, and read more of the repository if you need to.',
    '',
    where,
    '',
    `Question: ${BLIND_QUESTION[c.kind]}`,
    '',
    'Answer in at most three sentences. Be specific: name the exact values, keys, names or behavior. If the code doesn\'t tell you, say "unknown".',
  ].join('\n');
  return { located, prompt };
}

/** The grading prompt: the claim in full and the blind answer. */
export function gradePrompt(c: Claim, blind: string): string {
  return [
    'Someone read only the code, without any documentation, and answered a question about it. Compare their answer with a claim from the documentation.',
    '',
    `Claim (${KIND_NAME[c.kind]}): ${c.statement}`,
    ...(c.rationale.length ? ['', 'Rationale:', ...c.rationale] : []),
    '',
    'Their answer:',
    blind,
    '',
    'Answer on the first line with exactly one of:',
    'VERDICT: inferred   (the answer states the same rule, choice or behavior, specifically enough to act on)',
    'VERDICT: partial    (related but vaguer, only part of it, or, for a decision, the choice without why or what it rejected)',
    'VERDICT: missed     (it states something else, or says unknown)',
    'Then one sentence saying why.',
  ].join('\n');
}

export function parseInferVerdict(answer: string): InferVerdict {
  const m = /VERDICT:\s*\**\s*(inferred|partial|missed)\b/i.exec(answer);
  return (m?.[1]?.toLowerCase() as InferVerdict | undefined) ?? 'unsure';
}

/** Delete the graph from a worktree and strip every marker, so nothing in it says what a claim is. */
export function hideGraph(graph: Graph, dir: string, opts: { codeOnly?: boolean; hide?: string[] } = {}): void {
  for (const f of ['LORE.md', 'APP.md', '.lore', ...graph.folders, ...(opts.hide ?? [])]) rmSync(join(dir, f), { recursive: true, force: true });
  for (const f of repoFiles(dir)) {
    const abs = join(dir, f);
    if (!existsSync(abs)) continue;
    if (opts.codeOnly && /\.(md|mdx|markdown)$/i.test(f)) {
      rmSync(abs, { force: true });
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    // Line count stays the same, so snippets keep the numbers the graph's markers use.
    if (text.includes('@lore')) writeFileSync(abs, text.replace(/@lore\b[^\n]*?(?=\s*-->|\s*\*\/|$)/gm, ''));
  }
  // Empty node folders would still hint at structure.
  for (const f of graph.folders) if (existsSync(join(dir, f)) && !readdirSync(join(dir, f)).length) rmSync(join(dir, f), { recursive: true });
}

export interface InferOptions {
  refs?: string[];
  kinds?: Kind[];
  agent?: string;
  jobs?: number;
  timeoutMs?: number;
  rev?: string;
  codeOnly?: boolean;
  hide?: string[];
  /** Blind-and-grade passes per claim (default 1). Single verdicts vary between runs; more runs make "inferred" a firmer claim. */
  runs?: number;
  onResult?: (r: InferResult) => void;
}

const RANK: Record<InferVerdict, number> = { missed: 0, unsure: 0, partial: 1, inferred: 2 };

/** The least inferable of several verdicts; `missed` beats `unsure` at the bottom. */
export function combine(verdicts: InferVerdict[]): InferVerdict {
  const low = Math.min(...verdicts.map((v) => RANK[v]));
  if (low > 0) return low === 2 ? 'inferred' : 'partial';
  return verdicts.includes('missed') ? 'missed' : 'unsure';
}

/** Every active claim (or the ones asked for), blind then graded, `jobs` claims at a time. */
export async function infer(graph: Graph, opts: InferOptions = {}): Promise<{ results: InferResult[]; summary: InferSummary }> {
  const wanted = new Set((opts.refs ?? []).map(normalizeRef));
  const order = (c: Claim) => (c.node === 'lore' ? -1 : graph.nodes.get(c.node)!.order);
  const claims = [...graph.claims.values()]
    .filter((c) => c.active && (!wanted.size || wanted.has(normalizeRef(c.ref))) && (!opts.kinds?.length || opts.kinds.includes(c.kind)))
    .sort((a, b) => order(a) - order(b) || a.node.localeCompare(b.node) || a.line - b.line);
  const results = await withWorktree(graph.root, opts.rev, async (dir) => {
    hideGraph(graph, dir, opts);
    const out: InferResult[] = claims.map((c) => {
      const { located, prompt } = blindPrompt(graph, c, dir);
      return { ref: c.ref, kind: c.kind, statement: c.statement, located, blindPrompt: prompt };
    });
    if (!opts.agent) return out;
    const agent = opts.agent;
    let next = 0;
    const worker = async () => {
      while (next < out.length) {
        const i = next++;
        const r = out[i]!;
        const verdicts: InferVerdict[] = [];
        for (let run = 0; run < Math.max(1, opts.runs ?? 1); run++) {
          const blind = await runAgent(dir, r.blindPrompt, { agent, timeoutMs: opts.timeoutMs });
          if (blind.failed) {
            Object.assign(r, { blind: blind.answer, failed: true });
            verdicts.push('unsure');
            continue;
          }
          const graded = await runAgent(dir, gradePrompt(claims[i]!, blind.answer), { agent, timeoutMs: opts.timeoutMs });
          const v = graded.failed ? 'unsure' : parseInferVerdict(graded.answer);
          if (graded.failed) r.failed = true;
          // Keep the answer behind the lowest verdict: the one that says why it isn't (fully) inferable.
          if (!verdicts.length || RANK[v] < Math.min(...verdicts.map((x) => RANK[x]))) Object.assign(r, { blind: blind.answer, grade: graded.answer });
          verdicts.push(v);
        }
        r.verdict = combine(verdicts);
        if (verdicts.length > 1) r.runs = verdicts;
        opts.onResult?.(r);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.jobs ?? 4) }, worker));
    return out;
  });
  return { results, summary: summarizeInfer(results) };
}

export function summarizeInfer(results: InferResult[]): InferSummary {
  const blank = (): Record<InferVerdict, number> => ({ inferred: 0, partial: 0, missed: 0, unsure: 0 });
  const byKind: Record<Kind, Record<InferVerdict, number>> = { INV: blank(), DEC: blank(), NOTE: blank() };
  for (const r of results) if (r.verdict) byKind[r.kind][r.verdict]++;
  return {
    claims: results.length,
    byKind,
    inferred: results.filter((r) => r.verdict === 'inferred').map((r) => r.ref),
    partial: results.filter((r) => r.verdict === 'partial').map((r) => r.ref),
  };
}

export function inferText(results: InferResult[], s: InferSummary, graded: boolean): string {
  if (!graded) return results.map((r) => `=== ${r.ref} (${r.located})\n${r.blindPrompt}\n`).join('\n') || 'no claims\n';
  const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const lines = ['| Claim | Kind | Located | Verdict | From the code alone |', '|---|---|---|---|---|'];
  for (const r of results) lines.push(`| ${r.ref} | ${r.kind} | ${r.located} | ${r.verdict ?? '-'} | ${cell((r.blind ?? '').slice(0, 160))} |`);
  const row = (k: Kind) => {
    const v = s.byKind[k];
    const n = v.inferred + v.partial + v.missed + v.unsure;
    return n ? `${k}: ${v.inferred} inferred, ${v.partial} partial, ${v.missed} missed${v.unsure ? `, ${v.unsure} unsure` : ''} (of ${n})` : '';
  };
  lines.push(
    '',
    `${s.inferred.length} of ${s.claims} claims inferred from the code alone; ${s.partial.length} partly.`,
    ...(['INV', 'DEC', 'NOTE'] as Kind[]).map(row).filter(Boolean),
  );
  if (s.inferred.length) lines.push('', `Restate the code (candidates to cut, or to rewrite with the why): ${s.inferred.join(', ')}`);
  return lines.join('\n') + '\n';
}
