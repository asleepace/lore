import { parseFrontmatter } from './frontmatter';
import type { Claim, Issue, Kind, LoreNode } from './types';

/** Claim sections (v0.3) and the v0.1/v0.2 sections still read as `NOTE` (SPEC.md §12.1). */
export const SECTIONS: Record<string, { prefix: string; kind: Kind }> = {
  Invariants: { prefix: 'INV', kind: 'INV' },
  Decisions: { prefix: 'DEC', kind: 'DEC' },
  Notes: { prefix: 'NOTE', kind: 'NOTE' },
  Limits: { prefix: 'LIM', kind: 'NOTE' },
  Quirks: { prefix: 'QRK', kind: 'NOTE' },
  Edges: { prefix: 'EDGE', kind: 'NOTE' },
  Plans: { prefix: 'PLAN', kind: 'NOTE' },
};
const KIND_OF: Record<string, Kind> = Object.fromEntries(Object.values(SECTIONS).map((s) => [s.prefix, s.kind]));
export const kindOf = (prefix: string): Kind => KIND_OF[prefix] ?? 'NOTE';
const META = /^- ([a-z_]+): (.+)$/;

export function parseNode(text: string, id: string, path: string, folder: string, issues: Issue[]): LoreNode {
  const fm = parseFrontmatter(text);
  for (const p of fm.problems) {
    issues.push({ code: p.code, level: p.code === 'L015' ? 'error' : 'warn', where: `${path}:${p.line}`, message: p.message });
  }
  const lines = text.split('\n');
  const start = fm.lines;
  let title = '';
  let titleAt = -1;
  for (let i = start; i < lines.length; i++) {
    if (lines[i]!.startsWith('# ')) {
      title = lines[i]!.slice(2).trim();
      titleAt = i;
      break;
    }
  }
  if (titleAt < 0) issues.push({ code: 'L017', level: 'error', where: path, message: 'markdown file in a node folder without a "# Title"' });

  // The lead: the first paragraph after the title, before any "## ". A v0.1/v0.2 `summary` wins (§12.1).
  let lead = '';
  if (titleAt >= 0) {
    let j = titleAt + 1;
    while (j < lines.length && !lines[j]!.trim()) j++;
    const para: string[] = [];
    while (j < lines.length && lines[j]!.trim() && !lines[j]!.startsWith('#')) para.push(lines[j++]!.trim());
    lead = para.join(' ');
  }
  const summary = typeof fm.data.summary === 'string' ? fm.data.summary : '';
  if (summary) lead = summary;
  if (!lead && titleAt >= 0) issues.push({ code: 'L004', level: 'error', where: id, message: 'no lead paragraph after the title' });

  const claims: Claim[] = [];
  const openSections: string[] = [];
  let section: string | null = null;
  let current: { claim: Claim; body: string[] } | null = null;
  let fenced = false;
  const close = (endIdx: number) => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    const paras = body ? body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
    current.claim.statement = (paras[0] ?? '').replace(/\s*\n\s*/g, ' ');
    current.claim.rationale = paras.slice(1);
    let end = endIdx;
    while (end > current.claim.line && !lines[end - 1]!.trim()) end--;
    current.claim.endLine = end;
    current = null;
  };
  for (let i = Math.max(titleAt + 1, start); i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) {
      current?.body.push(line);
      continue;
    }
    if (line.startsWith('## ')) {
      close(i);
      section = line.slice(3).trim();
      if (!(section in SECTIONS)) openSections.push(section);
      continue;
    }
    const h = /^### ([A-Z]+)-(\d+)\b(.*)$/.exec(line);
    if (h) {
      close(i);
      const [, prefix, n, rest] = h;
      const cid = `${prefix}-${n}`;
      const where = `${id}#${cid}`;
      const expected = section ? SECTIONS[section] : undefined;
      if (!expected) issues.push({ code: 'L003', level: 'error', where, message: section ? `claim inside open section "${section}"` : 'claim outside any section' });
      else if (expected.prefix !== prefix) issues.push({ code: 'L003', level: 'error', where, message: `${prefix} claim under "## ${section}"` });
      if (rest!.trim()) issues.push({ code: 'L012', level: 'warn', where, message: 'claim heading holds text besides the ID' });
      if (claims.some((c) => c.id === cid)) issues.push({ code: 'L002', level: 'error', where, message: 'duplicate claim ID' });
      const claim: Claim = {
        ref: `${id}#${cid}`,
        node: id,
        id: cid,
        prefix: prefix!,
        kind: KIND_OF[prefix!] ?? 'NOTE',
        statement: '',
        rationale: [],
        meta: {},
        active: true,
        line: i + 1,
        endLine: i + 1,
      };
      claims.push(claim);
      current = { claim, body: [] };
      continue;
    }
    if (!current) continue;
    const m = META.exec(line);
    if (m) current.claim.meta[m[1]!] = m[2]!.trim();
    else if (!line.startsWith('>')) current.body.push(line); // comments are blockquotes: never part of the claim
  }
  close(lines.length);
  for (const c of claims) c.active = (c.meta.status ?? 'active') === 'active' && !c.meta.superseded_by;

  return { id, path, folder, title, lead, frontmatter: fm.data, claims, openSections, parent: 'lore', order: Number.MAX_SAFE_INTEGER, lines: lines.length };
}
