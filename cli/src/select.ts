import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { definitionsUsed } from './defs';
import type { Claim, ClaimRecord, Graph, Severity } from './types';
import { git, matchesAny, normalizeRef } from './util';

export interface Diff {
  /** New-side changed line numbers per file (1-based). Deleted files map to an empty set. */
  changed: Map<string, Set<number>>;
  /** Marker references on removed lines, per file. */
  removedRefs: Map<string, Set<string>>;
  /** Marker references on added lines, per file (a marker that moved isn't a removal). */
  addedRefs: Map<string, Set<string>>;
  /** Claim IDs (`INV-2`) whose `### ` heading lines were removed, per file. */
  removedHeadings: Map<string, Set<string>>;
}

const MARK = /@lore\s+(?:(?:see|enforces|implements)\s+)?([a-z][a-z0-9-]*#[A-Z]+-\d+(?:\s*,\s*[a-z][a-z0-9-]*#[A-Z]+-\d+)*)/gi;

/** Parse `git diff -U0` output. */
export function parseDiff(text: string): Diff {
  const changed = new Map<string, Set<number>>();
  const removedRefs = new Map<string, Set<string>>();
  const addedRefs = new Map<string, Set<string>>();
  const removedHeadings = new Map<string, Set<string>>();
  let oldFile: string | null = null;
  let file: string | null = null;
  let next = 0;
  const refsIn = (line: string) => [...line.matchAll(MARK)].flatMap((m) => m[1]!.split(',').map((r) => normalizeRef(r)));
  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) {
      oldFile = line.startsWith('--- a/') ? line.slice(6) : null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      const key = file ?? oldFile;
      if (key && !changed.has(key)) changed.set(key, new Set());
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      next = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      // A pure deletion (`+n,0`) touches the line it happened after.
      const key = file ?? oldFile;
      if (key && count === 0) changed.get(key)!.add(Math.max(next, 1));
      continue;
    }
    const key = file ?? oldFile;
    if (!key) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      changed.get(key)!.add(next++);
      for (const r of refsIn(line)) (addedRefs.get(key) ?? addedRefs.set(key, new Set()).get(key)!).add(r);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      for (const r of refsIn(line)) (removedRefs.get(key) ?? removedRefs.set(key, new Set()).get(key)!).add(r);
      // Text after the ID is allowed (L012 only warns), so a heading with a title counts too.
      const h = /^-###\s+([A-Z]+-\d+)\b/.exec(line);
      if (h) (removedHeadings.get(oldFile ?? key) ?? removedHeadings.set(oldFile ?? key, new Set()).get(oldFile ?? key)!).add(h[1]!);
    }
  }
  return { changed, removedRefs, addedRefs, removedHeadings };
}

/** `git diff -U0` for a range (`a..b`), a single revision (against the work tree), or staged changes. */
export function diffFor(root: string, range: string | undefined, staged = false): Diff {
  const args = ['diff', '-U0', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--cached');
  if (range) args.push(range);
  args.push('--');
  return parseDiff(git(root, args));
}

const BY_KIND: Record<Claim['kind'], Severity> = { INV: 'high', DEC: 'medium', NOTE: 'low' };
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function list(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The claims a diff might break, with a severity and the reasons (SPEC.md §5.3). Deterministic: no
 * model, the same input always gives the same answer.
 */
// @lore freshness#INV-1, freshness#DEC-7
export function selectClaims(graph: Graph, diff: Diff, opts: { covers?: boolean } = {}): ClaimRecord[] {
  const hits = new Map<string, { severity: Severity; reasons: string[] }>();
  const hit = (ref: string, severity: Severity, reason: string) => {
    const c = graph.claims.get(ref);
    if (!c || !c.active) return;
    const cur = hits.get(ref);
    if (!cur) hits.set(ref, { severity, reasons: [reason] });
    else {
      if (RANK[severity] < RANK[cur.severity]) cur.severity = severity;
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    }
  };

  for (const mk of graph.markers) {
    if (mk.verb !== 'upholds') continue;
    const lines = diff.changed.get(mk.file);
    if (!lines) continue;
    for (const n of lines) {
      if (n >= mk.line && n <= mk.endLine) {
        const c = graph.claims.get(mk.ref);
        if (c) hit(mk.ref, BY_KIND[c.kind], `changed ${mk.file}:${n} (marker at ${mk.line})`);
        break;
      }
    }
  }
  // A changed definition the region uses (a constant, a helper in the same file) changes what the
  // region means without touching it: same severity as a change inside it.
  const fileLines = new Map<string, string[]>();
  for (const mk of graph.markers) {
    if (mk.verb !== 'upholds') continue;
    const changed = diff.changed.get(mk.file);
    if (!changed?.size) continue;
    const abs = join(graph.root, mk.file);
    if (!fileLines.has(mk.file)) fileLines.set(mk.file, existsSync(abs) ? readFileSync(abs, 'utf8').split('\n') : []);
    const c = graph.claims.get(mk.ref);
    // A change inside the region already reached the claim, with the better reason.
    if (!c || [...changed].some((l) => l >= mk.line && l <= mk.endLine)) continue;
    for (const d of definitionsUsed(fileLines.get(mk.file)!, mk.line, mk.endLine)) {
      const n = [...changed].find((l) => l >= d.start && l <= d.end);
      if (n !== undefined) hit(mk.ref, BY_KIND[c.kind], `changed ${d.name} (${mk.file}:${n}), used by the marker at ${mk.line}`);
    }
  }
  for (const [file, refs] of diff.removedRefs) {
    const added = diff.addedRefs.get(file) ?? new Set();
    for (const r of refs) if (!added.has(r)) hit(r, 'high', `marker removed from ${file}`);
  }
  const files = [...diff.changed.keys()];
  for (const c of graph.claims.values()) {
    for (const t of list(c.meta.tests)) if (files.includes(t)) hit(normalizeRef(c.ref), 'medium', `test changed: ${t}`);
    for (const f of list(c.meta.files)) if (files.includes(f)) hit(normalizeRef(c.ref), 'medium', `upholding file changed: ${f}`);
  }
  // One hop along depends (§5.3), only from high-severity hits.
  const high = [...hits].filter(([, h]) => h.severity === 'high').map(([r]) => r);
  for (const c of graph.claims.values()) {
    for (const d of list(c.meta.depends).map(normalizeRef)) {
      if (high.includes(d)) hit(normalizeRef(c.ref), 'low', `depends on ${d}`);
    }
  }
  if (opts.covers !== false) {
    for (const node of graph.nodes.values()) {
      const globs = (Array.isArray(node.frontmatter.covers) ? node.frontmatter.covers : []).map(String);
      const f = globs.length ? files.find((file) => matchesAny(file, globs)) : undefined;
      if (f) for (const c of node.claims) hit(normalizeRef(c.ref), 'low', `covered file changed: ${f}`);
    }
  }

  return [...hits]
    .map(([ref, h]) => {
      const c = graph.claims.get(ref)!;
      return { ref: c.ref, kind: c.kind, statement: c.statement, severity: h.severity, reasons: h.reasons };
    })
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.ref.localeCompare(b.ref));
}
