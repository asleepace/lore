import type { ClaimRecord, Graph } from './types';
import { diffFor, selectClaims, type Diff } from './select';
import { git, normalizeRef } from './util';

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
  if (opts.range?.includes('..')) {
    const log = git(graph.root, ['log', '--format=%an%x1f%B%x1e', opts.range]);
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
  return { results };
}
