import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { questionFor } from './ask';
import type { Claim, ClaimRecord, Graph } from './types';
import { normalizeRef } from './util';

export type Verdict = 'holds' | 'broken' | 'unsure';

export interface CheckRecord extends ClaimRecord {
  prompt: string;
  verdict?: Verdict;
  answer?: string;
}

const CONTEXT_LINES = 8;
const MAX_SNIPPET_LINES = 80;
const MAX_PROMPT_CHARS = 16_000;
const KIND_WORDS: Record<Claim['kind'], string> = {
  INV: 'an invariant: it must always hold, and breaking it is a bug',
  DEC: 'a decision: a choice the code follows, with alternatives that were rejected',
  NOTE: 'a note: known behavior the code has',
};

function snippet(root: string, file: string, from: number, to: number): string | null {
  const abs = join(root, file);
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, 'utf8').split('\n');
  const start = Math.max(1, from - CONTEXT_LINES);
  const end = Math.min(lines.length, to + CONTEXT_LINES, start + MAX_SNIPPET_LINES - 1);
  const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join('\n');
  return `--- ${file}:${start}-${end}\n${body}`;
}

/**
 * The prompt for one claim (SPEC.md §8 step 3): the claim, its question, and the code that upholds
 * it, read from the work tree. The verdict asked for is always whether the claim still holds; the
 * question only says where to look. Deterministic: the same graph and files give the same prompt.
 */
// @lore cli#DEC-6
export function promptFor(graph: Graph, c: Claim): string {
  const node = graph.nodes.get(c.node)!;
  const parts: string[] = [
    'You are checking one claim from a Lore knowledge graph against the code in this repository.',
    '',
    `Claim: ${c.ref}, ${KIND_WORDS[c.kind]}.`,
    `Node: ${node.title}: ${node.lead}`,
    `Statement: ${c.statement}`,
  ];
  if (c.rationale.length) parts.push(`Rationale: ${c.rationale.join(' ').replace(/\s+/g, ' ')}`);
  parts.push(`Question: ${questionFor(c)}`, '');
  const marks = graph.markers.filter((m) => m.ref === normalizeRef(c.ref) && m.verb === 'upholds');
  const snippets = marks.map((m) => snippet(graph.root, m.file, m.line, m.endLine)).filter((s): s is string => !!s);
  const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const f of list(c.meta.files)) {
    const s = snippet(graph.root, f, 1, MAX_SNIPPET_LINES);
    if (s) snippets.push(s);
  }
  if (snippets.length) parts.push('Code that upholds it:', '', ...snippets, '');
  else parts.push('No code is marked as upholding this claim; look for it yourself.', '');
  if (list(c.meta.tests).length) parts.push(`Tests that enforce it: ${list(c.meta.tests).join(', ')}`, '');
  parts.push(
    'Answer on the first line with exactly one of:',
    'VERDICT: holds',
    'VERDICT: broken',
    'VERDICT: unsure',
    'Then explain in at most five sentences, citing file:line. Say "holds" only if the code shown (or that you read) makes the statement true; "unsure" if you can\'t tell.',
  );
  let prompt = parts.join('\n');
  if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n[truncated]\n';
  return prompt;
}

/** Every active invariant, in the map's reading order: what a sweep checks (SPEC.md §8). */
export function sweepTargets(graph: Graph): { ref: string }[] {
  const order = (id: string) => (id === 'lore' ? -1 : graph.nodes.get(id)!.order);
  return [...graph.claims.values()]
    .filter((c) => c.kind === 'INV' && c.active)
    .sort((a, b) => order(a.node) - order(b.node) || a.node.localeCompare(b.node) || a.line - b.line)
    .map((c) => ({ ref: c.ref }));
}

/** The first `VERDICT: …` line in an answer; anything else is `unsure`. */
export function parseVerdict(answer: string): Verdict {
  const m = /VERDICT:\s*\**\s*(holds|broken|unsure)\b/i.exec(answer);
  return (m?.[1]?.toLowerCase() as Verdict | undefined) ?? 'unsure';
}

export interface CheckOptions {
  /** A shell command that reads the prompt on stdin and prints the answer (`claude -p`, a script). */
  agent?: string;
  timeoutMs?: number;
}

/**
 * Check claims: build each prompt, and with an agent command, hand it over and read the verdict.
 * Without one, the prompts are returned for the caller (often an agent itself) to answer.
 */
export function check(graph: Graph, records: { ref: string }[], opts: CheckOptions = {}): CheckRecord[] {
  return records.flatMap((r) => {
    const c = graph.claims.get(normalizeRef(r.ref));
    if (!c) return [];
    const prompt = promptFor(graph, c);
    const base: CheckRecord = { ...(r as ClaimRecord), ref: c.ref, kind: c.kind, statement: c.statement, question: questionFor(c), prompt };
    if (!opts.agent) return [base];
    const run = spawnSync(opts.agent, { shell: true, input: prompt, encoding: 'utf8', cwd: graph.root, timeout: opts.timeoutMs ?? 180_000, maxBuffer: 8 * 1024 * 1024 });
    const answer = (run.stdout ?? '').trim() || (run.error ? `agent failed: ${run.error.message}` : (run.stderr ?? '').trim());
    return [{ ...base, answer, verdict: run.status === 0 ? parseVerdict(answer) : 'unsure' }];
  });
}
