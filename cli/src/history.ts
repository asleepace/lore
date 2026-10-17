import type { Graph } from './types';
import { git, normalizeRef } from './util';

export interface HistoryEntry {
  commit: string;
  date: string;
  author: string;
  subject: string;
  /** `message`: the commit message mentions the claim. `diff`: the commit added or removed a line that does. */
  via: ('message' | 'diff')[];
}

/**
 * Everything git knows about a claim, without anything declared: commits whose message mentions it
 * and commits whose diff adds or removes a line naming it (SPEC.md §6).
 */
// @lore format#DEC-13
export function history(graph: Graph, ref: string, limit = 50): HistoryEntry[] {
  const r = normalizeRef(ref);
  const fmt = ['--format=%H%x1f%ad%x1f%an%x1f%s', '--date=short', `-n${limit}`];
  // `room#INV-2` must not match `room#INV-21`.
  const pattern = `${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`;
  const byMessage = git(graph.root, ['log', ...fmt, '-i', '-E', `--grep=${pattern}`], true);
  const byDiff = git(graph.root, ['log', ...fmt, '-i', `-G${pattern}`], true);
  const entries = new Map<string, HistoryEntry>();
  const add = (out: string, via: 'message' | 'diff') => {
    for (const line of out.split('\n').filter(Boolean)) {
      const [commit = '', date = '', author = '', subject = ''] = line.split('\x1f');
      const e = entries.get(commit) ?? { commit, date, author, subject, via: [] };
      if (!e.via.includes(via)) e.via.push(via);
      entries.set(commit, e);
    }
  };
  add(byMessage, 'message');
  add(byDiff, 'diff');
  return [...entries.values()].sort((a, b) => b.date.localeCompare(a.date));
}
