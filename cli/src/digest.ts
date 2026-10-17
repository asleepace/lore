import type { Graph, LoreNode } from './types';
import { matchesAny } from './util';

export interface DigestOptions {
  depth: number;
  /** Only this node and its descendants. */
  node?: string;
  /** Only nodes whose `covers` match, or whose claims have markers in, these files. */
  files?: string[];
}

/** Nodes relevant to a set of files: covered by a node, or holding a marker for one of its claims. */
export function nodesForFiles(graph: Graph, files: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes.values()) {
    const globs = (Array.isArray(n.frontmatter.covers) ? n.frontmatter.covers : []).map(String);
    if (globs.length && files.some((f) => matchesAny(f, globs))) out.add(n.id);
  }
  for (const m of graph.markers) if (files.includes(m.file)) out.add(m.ref.split('#')[0]!);
  return out;
}

/**
 * The graph rendered at a depth (SPEC.md §7): 0 the root's lead, 1 the map with each node's lead,
 * 2 plus every active claim's statement, 3 plus rationale and metadata. Every layer is a summary of
 * the next, so this only keeps first paragraphs; nothing is generated.
 */
// @lore layers#DEC-5
export function digest(graph: Graph, opts: DigestOptions): string {
  const root = graph.nodes.get('lore')!;
  const children = (id: string) =>
    [...graph.nodes.values()].filter((n) => n.id !== 'lore' && n.parent === id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  let keep: Set<string> | null = null;
  if (opts.files?.length) keep = nodesForFiles(graph, opts.files);
  if (opts.node) {
    const sub = new Set<string>();
    const walk = (id: string) => {
      sub.add(id);
      for (const c of children(id)) walk(c.id);
    };
    walk(opts.node);
    keep = keep ? new Set([...keep].filter((id) => sub.has(id))) : sub;
  }
  const out: string[] = [`# ${root.title}`, '', root.lead, ''];
  if (opts.depth >= 2 && (!keep || keep.has('lore'))) out.push(...claimLines(root, opts.depth, ''), '');
  if (opts.depth < 1) return out.join('\n').trimEnd() + '\n';

  const render = (node: LoreNode, indent: string) => {
    const shown = !keep || keep.has(node.id);
    if (shown) {
      out.push(`${indent}- **${node.id}** (${node.path}): ${node.lead}`);
      if (opts.depth >= 2) out.push(...claimLines(node, opts.depth, `${indent}  `));
    }
    for (const c of children(node.id)) render(c, shown ? `${indent}  ` : indent);
  };
  for (const c of children('lore')) render(c, '');
  return out.join('\n').trimEnd() + '\n';
}

function claimLines(node: LoreNode, depth: number, indent: string): string[] {
  const lines: string[] = [];
  for (const c of node.claims) {
    if (!c.active) continue;
    lines.push(`${indent}- \`${c.ref}\` ${c.kind.toLowerCase()}: ${c.statement}`);
    if (depth >= 3) {
      for (const p of c.rationale) lines.push(`${indent}  ${p.replace(/\s*\n\s*/g, ' ')}`);
      for (const [k, v] of Object.entries(c.meta)) lines.push(`${indent}  (${k}: ${v})`);
    }
  }
  return lines;
}
