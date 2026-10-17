import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, posix, relative } from 'node:path';
import { parseFrontmatter } from './frontmatter';
import { scanMarkers } from './markers';
import { parseNode } from './node';
import type { Claim, Graph, Issue, LoreNode } from './types';
import { assertRev, git, normalizeRef, PREFIXES, REF_RX, repoFiles, stripCode } from './util';

function gatePolicy(v: unknown): Graph['gate'] {
  const s = String(v ?? 'warn');
  return s === 'off' || s === 'block' ? s : 'warn';
}

/**
 * The gate policy in `LORE.md` (or a v0.1 `APP.md`) at a revision, read with the same frontmatter
 * parser as the graph: what CI uses, so a change can't loosen its own gate (SPEC.md §9).
 */
export function gateAt(root: string, rev: string): Graph['gate'] {
  assertRev(rev);
  for (const f of ['LORE.md', 'APP.md']) {
    const text = git(root, ['show', `${rev}:./${f}`], true);
    if (text) return gatePolicy(parseFrontmatter(text).data.gate);
  }
  return 'warn';
}

const SUPPORTED_MAJOR = 0;

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v) return [v];
  return [];
}

export interface LoadOptions {
  /**
   * The date `review_after` is compared with (YYYY-MM-DD). An input like any other, so the same
   * repository and the same date always lint the same (cli#INV-3). Default: `$LORE_TODAY`, else today.
   */
  today?: string;
}

/** Read a whole graph: root, folders, nodes, the map's tree, markers, and the issues found on the way. */
export function loadGraph(root: string, opts: LoadOptions = {}): Graph {
  const issues: Issue[] = [];
  const rootFile = existsSync(join(root, 'LORE.md')) ? 'LORE.md' : existsSync(join(root, 'APP.md')) ? 'APP.md' : null;
  if (!rootFile) throw new Error(`no LORE.md (or v0.1 APP.md) in ${root}`);
  const rootText = readFileSync(join(root, rootFile), 'utf8');
  const rootFm = parseFrontmatter(rootText).data;

  let version = String(rootFm.lore ?? '');
  if (!version && typeof rootFm.spec === 'string') version = rootFm.spec.replace(/^lore\//, '');
  if (!version) issues.push({ code: 'L018', level: 'error', where: rootFile, message: 'no `lore:` version' });
  else if (Number(version.split('.')[0]) > SUPPORTED_MAJOR) {
    issues.push({ code: 'L018', level: 'error', where: rootFile, message: `lore ${version}: this tool reads major version ${SUPPORTED_MAJOR}` });
  }

  // `docs/` and `./docs` name the same folder as `docs`.
  let folders = list(rootFm.nodes).map((f) => posix.normalize(f).replace(/\/+$/, '') || '.');
  const legacy = join(root, '.lore/config.json');
  if (!folders.length && existsSync(legacy)) {
    const dir = (JSON.parse(readFileSync(legacy, 'utf8')) as { dir?: string }).dir;
    if (dir) folders = [dir];
  }
  if (!folders.length) folders = ['docs'];
  const publicFolders = list(rootFm.public);
  const gate = gatePolicy(rootFm.gate);

  const nodes = new Map<string, LoreNode>();
  const rootNode = parseNode(rootText, 'lore', rootFile, '.', issues);
  nodes.set('lore', rootNode);
  for (const folder of folders) {
    const abs = join(root, folder);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      issues.push({ code: 'L001', level: 'error', where: rootFile, message: `node folder "${folder}" doesn't exist` });
      continue;
    }
    for (const f of readdirSync(abs).sort()) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const id = f.slice(0, -3);
      const path = posix.join(folder, f);
      if (!/^[a-z][a-z0-9-]*$/.test(id) || id === 'lore') {
        issues.push({ code: 'L004', level: 'error', where: path, message: `"${id}" isn't a valid node ID` });
        continue;
      }
      if (nodes.has(id)) {
        issues.push({ code: 'L016', level: 'error', where: path, message: `node "${id}" also in ${nodes.get(id)!.folder}` });
        continue;
      }
      nodes.set(id, parseNode(readFileSync(join(abs, f), 'utf8'), id, path, folder, issues));
    }
  }

  // The map is the tree (§2.1); v0.1/v0.2 `parent` places nodes the map doesn't list (§12.1).
  const seen = new Map<string, number>();
  const map = /^## Map\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(stripCode(rootText).slice(0));
  if (map) {
    const stack: { indent: number; id: string }[] = [];
    for (const line of map[1]!.split('\n')) {
      const m = /^(\s*)[-*] \[[^\]]*\]\(([^)#\s]+\.md)[^)]*\)/.exec(line);
      if (!m) continue;
      const indent = m[1]!.length;
      const id = basename(m[2]!, '.md');
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const node = nodes.get(id);
      if (!node) issues.push({ code: 'L001', level: 'error', where: `${rootFile} map`, message: `map links to unknown node "${id}"` });
      else if (!seen.has(id)) {
        node.parent = stack.length ? stack[stack.length - 1]!.id : 'lore';
        node.order = seen.size;
      }
      seen.set(id, (seen.get(id) ?? 0) + 1);
      stack.push({ indent, id });
    }
  }
  for (const node of nodes.values()) {
    if (node.id === 'lore') continue;
    const count = seen.get(node.id) ?? 0;
    if (count === 0) {
      const legacyParent = typeof node.frontmatter.parent === 'string' ? normalizeRef(node.frontmatter.parent) : '';
      if (legacyParent && nodes.has(legacyParent)) node.parent = legacyParent;
      else issues.push({ code: 'L021', level: 'warn', where: node.id, message: 'node missing from the map' });
    } else if (count > 1) issues.push({ code: 'L021', level: 'warn', where: node.id, message: 'node listed in the map more than once' });
  }

  const claims = new Map<string, Claim>();
  for (const node of nodes.values()) for (const c of node.claims) claims.set(normalizeRef(c.ref), c);

  // Markers everywhere except the nodes themselves (a node's references are prose, not anchors).
  const nodePaths = new Set([...nodes.values()].map((n) => n.path));
  const markers = repoFiles(root)
    .filter((f) => !nodePaths.has(f) && !f.includes('node_modules/'))
    .flatMap((f) => {
      let text: string;
      try {
        text = readFileSync(join(root, f), 'utf8');
      } catch {
        return [];
      }
      if (!text.includes('@lore') || text.includes('\u0000')) return [];
      return scanMarkers(f, text, issues);
    });

  const graph: Graph = { root, version, folders, publicFolders, gate, nodes, claims, markers, issues };
  checkReferences(graph, opts.today ?? process.env.LORE_TODAY ?? new Date().toISOString().slice(0, 10));
  return graph;
}

export function resolve(graph: Graph, ref: string): Claim | LoreNode | undefined {
  const r = normalizeRef(ref);
  return r.includes('#') ? graph.claims.get(r) : graph.nodes.get(r);
}

/** Path from `fromFile` to the node file holding `ref`, as SPEC.md §4.2 maps references to links. */
export function linkFor(graph: Graph, ref: string, fromFile: string): string | undefined {
  const r = normalizeRef(ref);
  const [nodeId, claimId] = r.split('#');
  const node = graph.nodes.get(nodeId!);
  if (!node) return undefined;
  const rel = relative(dirname(fromFile), node.path).split('\\').join('/') || basename(node.path);
  return claimId ? `${rel}#${claimId.toLowerCase()}` : rel;
}

// @lore cli#INV-3
function checkReferences(graph: Graph, today: string): void {
  const { issues } = graph;
  const local = new RegExp(`(?<![#\\w-])((?:${PREFIXES.join('|')})-\\d+)\\b`, 'g');
  for (const node of graph.nodes.values()) {
    const text = stripCode(readFileSync(join(graph.root, node.path), 'utf8'));
    const isPublic = graph.publicFolders.includes(node.folder);
    for (const m of text.matchAll(REF_RX)) {
      const target = normalizeRef(m[1]!);
      if (!graph.nodes.has(target)) continue; // `foo#INV-1` for a node that doesn't exist is just text
      if (!graph.claims.has(normalizeRef(m[0]))) issues.push({ code: 'L001', level: 'error', where: node.id, message: `unresolved reference ${m[0]}` });
      if (isPublic && !graph.publicFolders.includes(graph.nodes.get(target)!.folder)) {
        issues.push({ code: 'L022', level: 'error', where: node.id, message: `public node references non-public "${target}"` });
      }
    }
    // Local references (`DEC-2`) must name a claim in the same node; comments and headings excluded.
    const own = new Set(node.claims.map((c) => c.id));
    text.split('\n').forEach((line) => {
      if (line.startsWith('#') || line.startsWith('>')) return;
      for (const m of line.matchAll(local)) {
        if (!own.has(m[1]!.toUpperCase())) issues.push({ code: 'L001', level: 'error', where: node.id, message: `local reference ${m[1]} has no claim in this node` });
      }
    });
    for (const c of node.claims) {
      const words = c.statement.split(/\s+/).filter(Boolean).length;
      if (words > 30) issues.push({ code: 'L011', level: 'warn', where: c.ref, message: `first paragraph is ${words} words` });
      if (c.kind === 'DEC' && c.active && !/^Rejected:/m.test(c.rationale.join('\n'))) {
        issues.push({ code: 'L013', level: 'info', where: c.ref, message: 'decision without a "Rejected:" line' });
      }
      const ra = c.meta.review_after;
      if (ra && /^\d{4}-\d{2}-\d{2}$/.test(ra) && ra < today) {
        issues.push({ code: 'L008', level: 'warn', where: c.ref, message: `review_after ${ra} has passed` });
      }
      for (const d of (c.meta.depends ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const t = graph.claims.get(normalizeRef(d));
        if (!t) issues.push({ code: 'L001', level: 'error', where: c.ref, message: `depends on unknown ${d}` });
        else if (!t.active) issues.push({ code: 'L023', level: 'warn', where: c.ref, message: `depends on inactive ${d}` });
      }
      if (c.meta.superseded_by && !graph.claims.has(normalizeRef(c.meta.superseded_by))) {
        issues.push({ code: 'L001', level: 'error', where: c.ref, message: `superseded by unknown ${c.meta.superseded_by}` });
      }
    }
    if (node.lines > 300) issues.push({ code: 'L010', level: 'warn', where: node.id, message: `${node.lines} lines` });
  }
  // A marker for a prefix this tool doesn't know (a newer minor version's kind) is ignored, like the
  // heading it points at (layers#INV-3).
  const known = new RegExp(`#(?:${PREFIXES.join('|')})-\\d+$`, 'i');
  for (const mk of graph.markers) {
    if (known.test(mk.ref) && !graph.claims.has(mk.ref)) issues.push({ code: 'L001', level: 'error', where: `${mk.file}:${mk.line}`, message: `marker points at unknown ${mk.ref}` });
  }
}
