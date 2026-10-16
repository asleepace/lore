import { tierOf } from './tiers';
import type { Claim, ClaimRecord, Graph, LoreNode, Tier } from './types';
import { globToRegExp, normalizeRef, PREFIXES, REF_RX, stripCode } from './util';

/**
 * Navigation over the derived graph (SPEC.md §6): the edges between claims that references already
 * state, so an agent can follow them instead of reading whole nodes. Nothing here is declared; every
 * edge comes from text a person wrote for another reason.
 *
 * - `depends`: a claim's `depends:` names another (it rests on it).
 * - `mentions`: a claim's statement or rationale references another.
 * - `superseded_by`: a retired claim names its replacement.
 * - `same-code`: two claims whose upholding code is the same block: marker regions that overlap or
 *   nearly touch, or a `files:` anchor on the whole file. Undirected, and only followed one hop
 *   from where a trace starts.
 */
// @lore format#DEC-13
export type Relation = 'depends' | 'mentions' | 'superseded_by' | 'same-code';

export interface Edge {
  /** The claim whose text or metadata holds the reference. */
  from: string;
  to: string;
  rel: Relation;
  /** For `same-code`, the shared file. */
  file?: string;
}

const LOCAL = new RegExp(`(?<![#\\w-])((?:${PREFIXES.join('|')})-\\d+)\\b`, 'g');
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/** Regions this close (at most one line between them, usually blank) are the same block of code. */
const NEAR = 2;
const STRENGTH: Record<Relation, number> = { depends: 0, superseded_by: 1, mentions: 2, 'same-code': 3 };

/** Files a claim is anchored in: `upholds` markers, `files:` and `tests:`. */
export function anchorsOf(graph: Graph, c: Claim): { file: string; line?: number; endLine?: number; via: 'marker' | 'see' | 'files' | 'tests' }[] {
  const ref = normalizeRef(c.ref);
  const out: ReturnType<typeof anchorsOf> = graph.markers
    .filter((m) => m.ref === ref)
    .map((m) => ({ file: m.file, line: m.line, endLine: m.endLine, via: m.verb === 'see' ? ('see' as const) : ('marker' as const) }));
  for (const f of list(c.meta.files)) out.push({ file: f, via: 'files' });
  for (const f of list(c.meta.tests)) out.push({ file: f, via: 'tests' });
  return out;
}

/** Every edge between claims, in a stable order. */
export function edges(graph: Graph): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  const add = (e: Edge) => {
    const key = `${e.from}|${e.rel}|${e.to}|${e.file ?? ''}`;
    if (e.from === e.to || seen.has(key) || !graph.claims.has(e.to)) return;
    seen.add(key);
    out.push(e);
  };
  for (const c of graph.claims.values()) {
    const from = normalizeRef(c.ref);
    for (const d of list(c.meta.depends)) add({ from, to: normalizeRef(d), rel: 'depends' });
    if (c.meta.superseded_by) add({ from, to: normalizeRef(c.meta.superseded_by), rel: 'superseded_by' });
    const text = stripCode([c.statement, ...c.rationale].join('\n'));
    for (const m of text.matchAll(REF_RX)) add({ from, to: normalizeRef(m[0]), rel: 'mentions' });
    for (const m of text.matchAll(LOCAL)) add({ from, to: normalizeRef(`${c.node}#${m[1]}`), rel: 'mentions' });
  }
  // Shared code: upholding regions in the same file that overlap or nearly touch (a `files:` anchor
  // is the whole file). One edge each way, so a trace can start from either claim. Same file alone
  // isn't enough: a long file or a spec with dozens of markers would join everything.
  const regions = new Map<string, { ref: string; from: number; to: number }[]>();
  for (const c of graph.claims.values()) {
    for (const a of anchorsOf(graph, c)) {
      if (a.via === 'see' || a.via === 'tests') continue;
      const r = { ref: normalizeRef(c.ref), from: a.line ?? 1, to: a.endLine ?? Number.MAX_SAFE_INTEGER };
      (regions.get(a.file) ?? regions.set(a.file, []).get(a.file)!).push(r);
    }
  }
  for (const [file, rs] of [...regions].sort(([a], [b]) => a.localeCompare(b))) {
    for (const a of rs) {
      for (const b of rs) {
        if (a.ref === b.ref || b.from > a.to + NEAR || a.from > b.to + NEAR) continue;
        const span = (x: typeof a) => (x.to === Number.MAX_SAFE_INTEGER ? '' : `:${x.from}`);
        add({ from: a.ref, to: b.ref, rel: 'same-code', file: `${file}${span(b)}` });
      }
    }
  }
  return out;
}

/** True if `file` is `pattern`, sits under it as a directory, or matches it as a glob. */
function pathMatches(file: string, pattern: string): boolean {
  const p = pattern.replace(/^\.\//, '').replace(/\/$/, '');
  if (/[*?]/.test(p)) return globToRegExp(p).test(file);
  return file === p || file.startsWith(p + '/');
}

export interface Start {
  /** What was asked for: a ref, a node ID or a path. */
  input: string;
  refs: string[];
  /** Why each ref is a start (`claim`, `in node room`, `marker at src/x.ts:12`). */
  why: Map<string, string>;
}

/** Resolve a ref, a node ID, or a file, directory or glob to the claims it names. */
export function resolveStart(graph: Graph, input: string, inactive = false): Start {
  const why = new Map<string, string>();
  const keep = (c: Claim | undefined) => !!c && (inactive || c.active);
  const r = normalizeRef(input);
  if (r.includes('#')) {
    const c = graph.claims.get(r);
    if (c) why.set(r, 'start');
  } else if (graph.nodes.has(r) && !input.includes('/') && !input.includes('.')) {
    for (const c of graph.nodes.get(r)!.claims) if (keep(c)) why.set(normalizeRef(c.ref), `in node ${r}`);
  } else {
    for (const c of graph.claims.values()) {
      if (!keep(c)) continue;
      const hit = anchorsOf(graph, c).find((a) => pathMatches(a.file, input));
      if (hit) why.set(normalizeRef(c.ref), hit.line ? `${hit.via === 'see' ? 'see marker' : 'marker'} at ${hit.file}:${hit.line}` : `${hit.via}: ${hit.file}`);
    }
  }
  return { input, refs: [...why.keys()], why };
}

export interface TraceRow extends ClaimRecord {
  /** Hops from the nearest start; 0 for the starts themselves. */
  hop: number;
  /** How it was reached, from this claim's side: `depends on room#INV-1`, `mentioned by host#INV-1`, `same code: src/x.ts`. */
  via: string;
  /** The claim it was reached from (absent for starts). */
  parent?: string;
  rel?: Relation;
  active: boolean;
}

export interface TraceOptions {
  /** `down`: what rests on the starts (what a change to them can break). `up`: what they rest on. */
  direction?: 'down' | 'up' | 'both';
  /** Maximum hops along `depends` and `mentions`. Default 3. */
  depth?: number;
  /** Follow `same-code` one hop from each start. Default true. */
  code?: boolean;
  /** Include retired and superseded claims. */
  inactive?: boolean;
}

/**
 * Walk the derived graph from some claims, a node or a file: breadth-first, each claim once at its
 * nearest hop, cycles cut. Deterministic: rows sort by hop, then edge strength, then map order.
 */
export function trace(graph: Graph, inputs: string[], opts: TraceOptions = {}): { starts: Start[]; rows: TraceRow[] } {
  const direction = opts.direction ?? 'down';
  const depth = opts.depth ?? 3;
  const all = edges(graph);
  const starts = inputs.map((i) => resolveStart(graph, i, opts.inactive));
  const rows = new Map<string, TraceRow>();
  const row = (ref: string, hop: number, via: string, parent?: string, rel?: Relation): TraceRow => {
    const c = graph.claims.get(ref)!;
    return { ref: c.ref, kind: c.kind, statement: c.statement, hop, via, parent, rel, active: c.active };
  };
  let frontier: string[] = [];
  for (const s of starts) {
    for (const ref of s.refs) {
      if (rows.has(ref)) continue;
      rows.set(ref, row(ref, 0, s.why.get(ref)!));
      frontier.push(ref);
    }
  }
  const usable = (ref: string) => {
    const c = graph.claims.get(ref);
    return !!c && (opts.inactive || c.active);
  };
  const down = direction !== 'up';
  const up = direction !== 'down';
  // Breadth-first along depends, superseded_by and mentions; edges in strength order, so at equal
  // hops the stronger relation names the row.
  const walkable = all.filter((e) => e.rel !== 'same-code').sort((a, b) => STRENGTH[a.rel] - STRENGTH[b.rel]);
  for (let hop = 1; hop <= depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const e of walkable) {
      for (const ref of frontier) {
        const name = graph.claims.get(ref)!.ref;
        let other: string | null = null;
        let via = '';
        if (down && e.to === ref) {
          other = e.from;
          via = e.rel === 'depends' ? `depends on ${name}` : e.rel === 'mentions' ? `mentions ${name}` : `superseded by ${name}`;
        } else if (up && e.from === ref) {
          other = e.to;
          via = e.rel === 'depends' ? `${name} depends on it` : e.rel === 'mentions' ? `mentioned by ${name}` : `supersedes ${name}`;
        }
        if (!other || rows.has(other) || !usable(other)) continue;
        rows.set(other, row(other, hop, via, ref, e.rel));
        next.push(other);
      }
    }
    frontier = next;
  }
  // Shared files: one hop from the starts, never walked further (a big file would join everything).
  if (opts.code !== false) {
    for (const s of starts) {
      for (const ref of s.refs) {
        for (const e of all) {
          if (e.rel !== 'same-code' || e.from !== ref || rows.has(e.to) || !usable(e.to)) continue;
          rows.set(e.to, row(e.to, 1, `same code as ${graph.claims.get(ref)!.ref}: ${e.file}`, ref, 'same-code'));
        }
      }
    }
  }
  const order = (ref: string) => {
    const c = graph.claims.get(normalizeRef(ref))!;
    return (c.node === 'lore' ? -1 : graph.nodes.get(c.node)!.order) * 1e6 + c.line;
  };
  const sorted = [...rows.values()].sort(
    (a, b) => a.hop - b.hop || (a.rel ? STRENGTH[a.rel] : -1) - (b.rel ? STRENGTH[b.rel] : -1) || order(a.ref) - order(b.ref),
  );
  return { starts, rows: sorted };
}

export interface Shown {
  ref: string;
  kind: Claim['kind'];
  statement: string;
  rationale: string[];
  active: boolean;
  tier: Tier | null;
  /** `docs/room.md:12`. */
  at: string;
  meta: Record<string, string>;
  anchors: ReturnType<typeof anchorsOf>;
  /** Edges grouped from this claim's side. */
  edges: Record<'dependsOn' | 'dependedOnBy' | 'mentions' | 'mentionedBy' | 'supersededBy' | 'supersedes' | 'sameCode', string[]>;
}

/** One claim with everything around it, without reading its node. */
export function show(graph: Graph, ref: string): Shown | null {
  const c = graph.claims.get(normalizeRef(ref));
  if (!c) return null;
  const me = normalizeRef(c.ref);
  const name = (r: string) => graph.claims.get(r)!.ref;
  const all = edges(graph);
  const out = (rel: Relation) => all.filter((e) => e.from === me && e.rel === rel).map((e) => name(e.to));
  const inn = (rel: Relation) => all.filter((e) => e.to === me && e.rel === rel).map((e) => name(e.from));
  const shared = new Map<string, string[]>();
  for (const e of all) if (e.from === me && e.rel === 'same-code') (shared.get(e.to) ?? shared.set(e.to, []).get(e.to)!).push(e.file!);
  const sameCode = [...shared].map(([r, files]) => `${name(r)} (${files.join(', ')})`);
  return {
    ref: c.ref,
    kind: c.kind,
    statement: c.statement,
    rationale: c.rationale,
    active: c.active,
    tier: tierOf(graph, c),
    at: `${graph.nodes.get(c.node)!.path}:${c.line}`,
    meta: c.meta,
    anchors: anchorsOf(graph, c),
    edges: {
      dependsOn: out('depends'),
      dependedOnBy: inn('depends'),
      mentions: out('mentions'),
      mentionedBy: inn('mentions'),
      supersededBy: out('superseded_by'),
      supersedes: inn('superseded_by'),
      sameCode,
    },
  };
}

export interface NodeShown {
  id: string;
  path: string;
  title: string;
  lead: string;
  parent: string | null;
  children: string[];
  openSections: string[];
  claims: { ref: string; kind: Claim['kind']; statement: string; active: boolean }[];
}

export function showNode(graph: Graph, id: string): NodeShown | null {
  const n: LoreNode | undefined = graph.nodes.get(normalizeRef(id));
  if (!n) return null;
  const children = [...graph.nodes.values()].filter((x) => x.id !== 'lore' && x.parent === n.id).sort((a, b) => a.order - b.order).map((x) => x.id);
  return {
    id: n.id,
    path: n.path,
    title: n.title,
    lead: n.lead,
    parent: n.id === 'lore' ? null : n.parent,
    children,
    openSections: n.openSections,
    claims: n.claims.map((c) => ({ ref: c.ref, kind: c.kind, statement: c.statement, active: c.active })),
  };
}

export interface FindOptions {
  /** Words that must all appear in the ref, statement or rationale (case-insensitive). */
  text?: string[];
  kinds?: Claim['kind'][];
  /** This node and the nodes under it in the map. */
  node?: string;
  /** Anchored in this file, directory or glob. */
  file?: string;
  tier?: Tier;
  inactive?: boolean;
}

export interface FoundRecord extends ClaimRecord {
  tier: Tier | null;
  active: boolean;
}

/** Claims matching every filter given, in map order. Records pipe into `ask`, `check` and `trace`. */
export function find(graph: Graph, opts: FindOptions): FoundRecord[] {
  let under: Set<string> | null = null;
  if (opts.node) {
    under = new Set();
    const walk = (id: string) => {
      under!.add(id);
      for (const n of graph.nodes.values()) if (n.id !== 'lore' && n.parent === id && !under!.has(n.id)) walk(n.id);
    };
    walk(normalizeRef(opts.node));
  }
  const fileRefs = opts.file ? new Set(resolveStart(graph, opts.file, true).refs) : null;
  const words = (opts.text ?? []).map((w) => w.toLowerCase()).filter(Boolean);
  const order = (c: Claim) => (c.node === 'lore' ? -1 : graph.nodes.get(c.node)!.order);
  return [...graph.claims.values()]
    .filter((c) => {
      if (!opts.inactive && !c.active) return false;
      if (opts.kinds?.length && !opts.kinds.includes(c.kind)) return false;
      if (under && !under.has(c.node)) return false;
      if (fileRefs && !fileRefs.has(normalizeRef(c.ref))) return false;
      if (opts.tier && tierOf(graph, c) !== opts.tier) return false;
      if (words.length) {
        const hay = [c.ref, c.statement, ...c.rationale].join(' ').toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => order(a) - order(b) || a.node.localeCompare(b.node) || a.line - b.line)
    .map((c) => ({ ref: c.ref, kind: c.kind, statement: c.statement, tier: tierOf(graph, c), active: c.active }));
}
