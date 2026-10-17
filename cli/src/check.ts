import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { questionFor } from './ask';
import { onStop } from './cleanup';
import { definitionsUsed } from './defs';
import type { Claim, ClaimRecord, Graph } from './types';
import { normalizeRef } from './util';

/** `preexisting`: the code broke the claim before the change under review, which doesn't make it worse. */
export type Verdict = 'holds' | 'broken' | 'preexisting' | 'unsure';

export interface CheckRecord extends ClaimRecord {
  prompt: string;
  verdict?: Verdict;
  answer?: string;
  /** The agent command failed (non-zero exit, a timeout): the verdict is `unsure`, but nothing was judged. */
  failed?: boolean;
}

const CONTEXT_LINES = 8;
const MAX_SNIPPET_LINES = 80;
const MAX_PROMPT_CHARS = 16_000;
/** A review's prompts carry the diff, so they get more room; a longer diff is cut. */
const MAX_DIFF_CHARS = 24_000;
const KIND_WORDS: Record<Claim['kind'], string> = {
  INV: 'an invariant: it must always hold, and breaking it is a bug',
  DEC: 'a decision: a choice the code follows, with alternatives that were rejected',
  NOTE: 'a note: known behavior the code has',
};

export function snippet(root: string, file: string, from: number, to: number): string | null {
  const abs = join(root, file);
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, 'utf8').split('\n');
  const start = Math.max(1, from - CONTEXT_LINES);
  const end = Math.min(lines.length, to + CONTEXT_LINES, start + MAX_SNIPPET_LINES - 1);
  const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join('\n');
  return `--- ${file}:${start}-${end}\n${body}`;
}

const MAX_DEFINITIONS = 4;

/** The definitions a region uses, outside the lines the prompt already shows, as numbered snippets. */
function definitionSnippets(root: string, file: string, from: number, to: number): string[] {
  const abs = join(root, file);
  if (!existsSync(abs)) return [];
  const lines = readFileSync(abs, 'utf8').split('\n');
  return definitionsUsed(lines, from, to, { skipFrom: Math.max(1, from - CONTEXT_LINES), skipTo: to + CONTEXT_LINES })
    .slice(0, MAX_DEFINITIONS)
    .map(({ start, end }) => `--- ${file}:${start}-${end}\n${lines.slice(start - 1, end).map((l, k) => `${String(start + k).padStart(5)}  ${l}`).join('\n')}`);
}

/**
 * The prompt for one claim (SPEC.md §8 step 3): the claim, its question, and the code that upholds
 * it, read from the work tree. The verdict asked for is always whether the claim still holds; the
 * question only says where to look. Deterministic: the same graph and files give the same prompt.
 */
// @lore cli#DEC-6
export function promptFor(graph: Graph, c: Claim, change?: { diff: string; why?: string }): string {
  const node = graph.nodes.get(c.node)!;
  const parts: string[] = [
    change
      ? 'You are reviewing a change against one claim from a Lore knowledge graph: does this change break it?'
      : 'You are checking one claim from a Lore knowledge graph against the code in this repository.',
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
  const defs = [...new Set(marks.flatMap((m) => definitionSnippets(graph.root, m.file, m.line, m.endLine)))];
  if (defs.length) parts.push('Definitions the code above uses, from elsewhere in the same file:', '', ...defs, '');
  if (list(c.meta.tests).length) parts.push(`Tests that enforce it: ${list(c.meta.tests).join(', ')}`, '');
  if (change) return changeTail(parts, change);
  parts.push(
    'Answer on the first line with exactly one of:',
    'VERDICT: holds',
    'VERDICT: broken',
    'VERDICT: unsure',
    'Then explain in at most five sentences, citing file:line. Say "holds" only if the code shown (or that you read) makes the statement true; "unsure" if you can\'t tell.',
    'Judge what the code does now, line by line, not what tests, comments or names say it should do. If the verdict depends on code you have not read (a function, constant or caller the code above relies on), read it first, or answer unsure.',
  );
  let prompt = parts.join('\n');
  if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n[truncated]\n';
  return prompt;
}

/**
 * The rest of a review prompt (SPEC.md §8): the diff, and a verdict about the change. The claim is
 * judged by the guarantee it protects, in every path the change adds, not only its marked code: a
 * check that only reads the marked code misses a break in a new code path (cli#NOTE-8).
 */
// @lore cli#DEC-13
function changeTail(parts: string[], change: { diff: string; why?: string }): string {
  const diff = change.diff.length > MAX_DIFF_CHARS ? change.diff.slice(0, MAX_DIFF_CHARS) + '\n[diff truncated; read the files for the rest]\n' : change.diff;
  if (change.why) parts.push(`Why this claim is being checked: ${change.why}`, '');
  parts.push(
    'The change under review (git diff; the files on disk already include it):',
    '',
    '```diff',
    diff.trimEnd(),
    '```',
    '',
    'Answer on the first line with exactly one of:',
    'VERDICT: holds        (after this change, the claim is still true)',
    'VERDICT: broken       (this change breaks or weakens it)',
    'VERDICT: preexisting  (the code already broke it before this change, and the change does not make it worse)',
    'VERDICT: unsure',
    'Then explain in at most five sentences, citing file:line.',
    'Judge the guarantee the claim protects: the rationale says why it exists, and a change can break that guarantee while keeping the literal wording. Look at every code path the change adds or alters, including ones no marker points at, and the code they reach. Judge what the code does, not what tests, comments or names say it should do; read anything the verdict depends on, or answer unsure.',
  );
  const prompt = parts.join('\n');
  return prompt.length > MAX_PROMPT_CHARS + MAX_DIFF_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS + MAX_DIFF_CHARS) + '\n[truncated]\n' : prompt;
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
  const m = /VERDICT:\s*\**\s*(holds|broken|preexisting|unsure)\b/i.exec(answer);
  return (m?.[1]?.toLowerCase() as Verdict | undefined) ?? 'unsure';
}

export interface CheckOptions {
  /** A shell command that reads the prompt on stdin and prints the answer (`claude -p`, a script). */
  agent?: string;
  timeoutMs?: number;
}

/** Each claim's prompt and question, without asking anyone: what a caller (often an agent itself) answers. */
export function prepare(graph: Graph, records: { ref: string }[]): CheckRecord[] {
  return records.flatMap((r) => {
    const c = graph.claims.get(normalizeRef(r.ref));
    if (!c) return [];
    return [{ ...(r as ClaimRecord), ref: c.ref, kind: c.kind, statement: c.statement, question: questionFor(c), prompt: promptFor(graph, c) }];
  });
}

/**
 * Hand one prompt to the agent command and read its verdict: the only place an agent runs, so
 * `check`, `review` and `bench` judge the same way. A non-zero exit or a timeout is `unsure` and
 * `failed`, never `holds`.
 */
// @lore cli#DEC-6
export function runAgent(root: string, prompt: string, opts: CheckOptions & { agent: string }): Promise<{ answer: string; verdict: Verdict; failed?: true }> {
  // The prompt goes in through a file, not a pipe: a pipe needs this process's event loop to feed
  // it, and a caller doing other work can leave an agent waiting for input it gives up on.
  const dir = mkdtempSync(join(tmpdir(), 'lore-prompt-'));
  const file = join(dir, 'prompt.txt');
  writeFileSync(file, prompt);
  const fd = openSync(file, 'r');
  return new Promise((done) => {
    // Its own process group, so a timeout or a stopped run kills the agent and anything it started,
    // not just the shell: a grandchild holding the pipes open would otherwise hang the run.
    const child = spawn(opts.agent, { shell: true, cwd: root, stdio: [fd, 'pipe', 'pipe'], detached: true });
    closeSync(fd);
    const kill = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const off = onStop(kill);
    let out = '';
    let err = '';
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      rmSync(dir, { recursive: true, force: true });
      const answer = out.trim() || err.trim() || (timedOut ? 'agent timed out' : `agent exited ${code}`);
      done(code === 0 && !timedOut ? { answer, verdict: parseVerdict(answer) } : { answer, verdict: 'unsure', failed: true });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      // If something still holds the pipes, don't wait for them.
      setTimeout(() => finish(null), 2_000).unref();
    }, opts.timeoutMs ?? 180_000);
    child.stdout!.on('data', (d) => (out += d));
    child.stderr!.on('data', (d) => (err += d));
    child.on('error', (e) => (err += e.message));
    child.on('close', (code) => finish(code));
  });
}

/** How many to run at once: a positive integer, else 4 (`--jobs auto` mustn't mean none). */
export function workers(n: number | undefined): number {
  const k = Math.floor(Number(n));
  return Number.isFinite(k) && k >= 1 ? Math.min(k, 64) : 4;
}

/** Check claims with an agent, `jobs` at a time (default 4), results in input order. */
export async function checkAll(
  graph: Graph,
  records: { ref: string }[],
  opts: CheckOptions & { agent: string; jobs?: number; onResult?: (r: CheckRecord) => void },
): Promise<CheckRecord[]> {
  const todo = prepare(graph, records);
  const out: CheckRecord[] = new Array(todo.length);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = next++;
      const r = todo[i]!;
      out[i] = { ...r, ...(await runAgent(graph.root, r.prompt, opts)) };
      opts.onResult?.(out[i]!);
    }
  };
  await Promise.all(Array.from({ length: workers(opts.jobs) }, worker));
  return out;
}
