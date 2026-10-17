import type { ClaimRecord, Graph } from './types';
import { diffFor, selectClaims, type Diff } from './select';
import { kindOf } from './node';
import { assertRev, git, normalizeRef } from './util';

export interface GateResult extends ClaimRecord {
  /** How the gate was met, or `unmet`. */
  status: 'updated' | 'acknowledged' | 'verified' | 'unmet';
}

export interface GateOptions {
  range?: string;
  staged?: boolean;
  /** Extra text to search for trailers (a PR description). */
  message?: string;
  /** Authors whose commits never trigger a gate (SPEC.md §9). */
  bot?: RegExp;
}

/** Trailers in commit messages: `Lore-Ack: ref` and `Lore-Verified: ref`, comma-separated refs allowed. */
export function trailers(text: string): { ack: Set<string>; verified: Set<string> } {
  const ack = new Set<string>();
  const verified = new Set<string>();
  for (const m of text.matchAll(/^Lore-(Ack|Verified):\s*(.+)$/gim)) {
    const set = m[1]!.toLowerCase() === 'ack' ? ack : verified;
    for (const r of m[2]!.split(',')) {
      const ref = r.trim().split(/\s+/)[0];
      if (ref) set.add(normalizeRef(ref));
    }
  }
  return { ack, verified };
}

/**
 * Invariant gates (SPEC.md §9): every active `INV` a change reaches must be updated in the same
 * change, acknowledged (`Lore-Ack:`) or verified (`Lore-Verified:`). The policy (`off`, `warn`,
 * `block`) decides what an unmet gate does; this only reports.
 */
// @lore layers#DEC-6, layers#QRK-1
export function checkGates(graph: Graph, opts: GateOptions): { results: GateResult[]; skipped?: string } {
  let messages = opts.message ?? '';
  assertRev(opts.range);
  if (opts.range?.includes('..')) {
    // `base...head` diffs from the merge base; for the log that's `base..head` (not the symmetric difference).
    const log = git(graph.root, ['log', '--format=%an%x1f%B%x1e', opts.range.replace('...', '..')]);
    const commits = log.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => {
      const [author = '', body = ''] = c.split('\x1f');
      return { author, body };
    });
    const bot = opts.bot ?? /\[bot\]$/;
    if (commits.length && commits.every((c) => bot.test(c.author))) return { results: [], skipped: 'every commit in the range is by a bot' };
    messages += '\n' + commits.map((c) => c.body).join('\n');
  }
  const diff: Diff = diffFor(graph.root, opts.range, opts.staged);
  const { ack, verified } = trailers(messages);
  const reached = selectClaims(graph, diff, { covers: false }).filter((r) => {
    if (r.kind !== 'INV') return false;
    return (r.reasons ?? []).some((why) => why.startsWith('changed ') || why.startsWith('marker removed') || why.startsWith('test changed') || why.startsWith('upholding file changed'));
  });
  const results = reached.map((r): GateResult => {
    const c = graph.claims.get(normalizeRef(r.ref))!;
    const node = graph.nodes.get(c.node)!;
    const touched = [...(diff.changed.get(node.path) ?? [])].some((n) => n >= c.line && n <= c.endLine);
    const key = normalizeRef(r.ref);
    const status = touched ? 'updated' : verified.has(key) ? 'verified' : ack.has(key) ? 'acknowledged' : 'unmet';
    return { ...r, status };
  });
  // Claims are never deleted, so their numbers are never reused (format#INV-2): a removed heading
  // whose ID is gone from the node is unmet whatever trailers say. Retire claims with `status`.
  // @lore format#INV-2
  for (const [file, ids] of diff.removedHeadings) {
    // Only nodes hold claims: a `### INV-1` in a spec's example or a README isn't one. A deleted file
    // was a node if it sat in a node folder or was the root (`APP.md` is v0.1's `LORE.md`, §14.1).
    const base = file.replace(/^.*\//, '');
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
    const root = file === 'LORE.md' || file === 'APP.md';
    const node = [...graph.nodes.values()].find((n) => n.path === file);
    const wasNode = root || (graph.folders.includes(folder) && base.endsWith('.md') && !base.startsWith('_'));
    if (!node && !wasNode) continue;
    const nodeId = root ? 'lore' : (node?.id ?? base.replace(/\.md$/, '').toLowerCase());
    const now = graph.nodes.get(nodeId);
    for (const id of ids) {
      if (now?.claims.some((c) => c.id === id)) continue; // moved, reworded or renamed, still there
      results.push({
        ref: `${nodeId}#${id}`,
        kind: kindOf(id.split('-')[0]!),
        statement: '(deleted)',
        severity: 'high',
        reasons: ['claim heading deleted: retire it with `- status: retired` instead, so its number is never reused'],
        status: 'unmet',
      });
    }
  }
  return { results };
}
