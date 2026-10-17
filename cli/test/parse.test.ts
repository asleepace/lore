import { afterEach, describe, expect, test } from 'bun:test';
import { parseFrontmatter } from '../src/frontmatter';
import { linkFor, loadGraph } from '../src/graph';
import { scanMarkers } from '../src/markers';
import type { Issue } from '../src/types';
import { AT, BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();

describe('frontmatter subset', () => {
  test('a colon in a plain value is L015, with a fix in the message', () => {
    const r = parseFrontmatter('---\nsummary: The wire format: typed frames\n---\n# X\n');
    expect(r.problems.map((p) => p.code)).toEqual(['L015']);
    expect(r.problems[0]!.message).toContain('double quotes');
    expect(r.problems[0]!.line).toBe(2);
  });

  test('quoted values, flow lists, numbers and dates parse', () => {
    const r = parseFrontmatter('---\nlore: 0.3\nnodes: [docs, "packages/sdk/lore"]\nsummary: "a: b"\nverified: 2026-10-16\n---\n');
    expect(r.problems).toEqual([]);
    expect(r.data).toEqual({ lore: '0.3', nodes: ['docs', 'packages/sdk/lore'], summary: 'a: b', verified: '2026-10-16' });
  });

  test('valid YAML outside the subset is L019, and v0.2 block lists still read', () => {
    const r = parseFrontmatter("---\nowner: 'team'\nlinks:\n  - { to: room, rel: related }\n---\n");
    expect(r.problems.map((p) => p.code)).toEqual(['L019']);
    expect(r.data.links).toEqual(['{ to: room, rel: related }']);
  });

  test('a version keeps its digits (0.10 is not 0.1)', () => {
    expect(parseFrontmatter('---\nlore: 0.10\nn: 3\n---\n').data).toEqual({ lore: '0.10', n: 3 });
  });

  test('unterminated quotes and lists are L015', () => {
    expect(parseFrontmatter('---\na: "open\nb: [x, y\n---\n').problems.map((p) => p.code)).toEqual(['L015', 'L015']);
  });
});

describe('markers', () => {
  test('a region runs to the next blank line or marker', () => {
    const issues: Issue[] = [];
    const m = scanMarkers('a.ts', `// ${AT} a#INV-1\nx\ny\n\nz\n// ${AT} a#INV-2\n// ${AT} see a#NOTE-1\nw\n`, issues);
    expect(m.map((x) => [x.ref, x.line, x.endLine, x.verb])).toEqual([
      ['a#INV-1', 1, 3, 'upholds'],
      ['a#INV-2', 6, 6, 'upholds'],
      ['a#NOTE-1', 7, 8, 'see'],
    ]);
    expect(issues).toEqual([]);
  });

  test('local references and unknown verbs are L006; v0.2 verbs still read', () => {
    // @lore markers#INV-1
    const issues: Issue[] = [];
    const m = scanMarkers('a.ts', `// ${AT} INV-1\n// ${AT} blesses a#INV-1\n// ${AT} enforces a#INV-2, b#DEC-1\n`, issues);
    expect(codes(issues)).toEqual(['L006', 'L006']);
    expect(m.map((x) => x.ref)).toEqual(['a#INV-2', 'b#DEC-1']);
  });

  test('prose about markers is not a marker', () => {
    const issues: Issue[] = [];
    expect(scanMarkers('a.ts', `/** write \`${AT} <ref>\` or \`${AT} see <ref>\` */\n`, issues)).toEqual([]);
    expect(issues).toEqual([]);
  });

  test('in markdown only HTML comments count, never fenced or inline code', () => {
    // @lore markers#DEC-3
    const md = `A rule. <!-- ${AT} a#INV-1 -->\n\n\`<!-- ${AT} a#INV-2 -->\`\n\n\`\`\`\n<!-- ${AT} a#INV-3 -->\n\`\`\`\n\n${AT} a#INV-4\n`;
    expect(scanMarkers('SPEC.md', md, []).map((x) => x.ref)).toEqual(['a#INV-1']);
  });
});

describe('graph', () => {
  test('the map is the tree; claims, kinds and the lead are read', () => {
    // @lore format#DEC-13
    repo = makeRepo(BASE);
    const g = loadGraph(repo.dir);
    expect(g.issues).toEqual([]);
    expect(g.nodes.get('host')!.parent).toBe('room');
    expect(g.nodes.get('room')!.parent).toBe('lore');
    expect(g.nodes.get('room')!.lead).toBe("One room's rules.");
    expect([...g.claims.keys()]).toContain('room#NOTE-1');
    expect(g.claims.get('room#INV-1')!.rationale).toEqual(['Anyone else gets an error.']);
    expect(g.markers.map((m) => m.ref)).toEqual(['room#INV-1', 'room#INV-2', 'room#NOTE-1']);
  });

  test('a node missing from the map is L021; a claim in an open section is L003; unknown references are L001', () => {
    repo = makeRepo({
      ...BASE,
      'docs/extra.md': '# Extra\n\nNot in the map.\n\n## Notes about things\n\n### NOTE-1\nOops.\n\nSee room#INV-9 and DEC-4.\n',
    });
    expect(codes(loadGraph(repo.dir).issues)).toEqual(['L001', 'L001', 'L003', 'L021']);
  });

  test("a claim prefix the tool doesn't know is open text anywhere, and ends the claim before it", () => {
    repo = makeRepo({
      ...BASE,
      'docs/host.md': '# Host\n\nHow the host role stays on a tab.\n\n## Invariants\n\n### INV-1\nA silent host is replaced.\n\n### RISK-1\nA newer kind.\n\n## Risks\n\n### RISK-2\nAnother.\n',
    });
    const g = loadGraph(repo.dir);
    expect(g.issues).toEqual([]);
    expect([...g.claims.keys()].filter((k) => k.startsWith('host#'))).toEqual(['host#INV-1']);
    expect(g.claims.get('host#INV-1')!.rationale).toEqual([]);
    // A marker for an unknown prefix is ignored too, not an L001.
    repo.write('src/risk.ts', `// ${AT} host#RISK-1\nexport const r = 1;\n`);
    expect(loadGraph(repo.dir).issues).toEqual([]);
  });

  test('two folders can share no node ID (L016); a public node may not reference a private one (L022)', () => {
    repo = makeRepo({
      ...BASE,
      'LORE.md': BASE['LORE.md']!.replace('nodes: [docs]', 'nodes: [docs, pkg/lore]\npublic: [pkg/lore]').replace('  - [host](docs/host.md)', '  - [host](docs/host.md)\n- [api](pkg/lore/api.md)'),
      'pkg/lore/api.md': '# API\n\nThe public contract.\n\n## Invariants\n\n### INV-1\nCalls are idempotent, unlike room#INV-1.\n',
      'pkg/lore/room.md': '# Room again\n\nDuplicate.\n',
    });
    expect(codes(loadGraph(repo.dir).issues)).toEqual(['L016', 'L022']);
  });

  test('a v0.1 graph reads: APP.md, .lore/config.json, summary as lead, parent, legacy types', () => {
    repo = makeRepo({
      'APP.md': '---\nspec: lore/0.1\nscope: app\nsummary: "The app."\n---\n\n# App\n\nLong form: PLAN.md.\n',
      '.lore/config.json': '{ "dir": "lore" }\n',
      'lore/a.md': '---\nscope: domain\nparent: app\nsummary: "Node a: the first."\n---\n\n# A\n\nLong form elsewhere.\n\n## Limits\n\n### LIM-1\nOne host only.\n',
      'lore/b.md': '---\nscope: feature\nparent: a\nsummary: "Node b."\n---\n\n# B\n\nContext.\n\n## Plans\n\n### PLAN-1\nSplit it.\n\n- review_after: 2099-01-01\n',
    });
    const g = loadGraph(repo.dir);
    expect(g.version).toBe('0.1');
    expect(g.issues).toEqual([]);
    expect(g.nodes.get('a')!.lead).toBe('Node a: the first.');
    expect(g.nodes.get('b')!.parent).toBe('a');
    expect(g.claims.get('a#LIM-1')!.kind).toBe('NOTE');
    expect(g.claims.get('b#PLAN-1')!.kind).toBe('NOTE');
  });

  test('references map to links relative to the file they are written in', () => {
    // @lore format#INV-3
    repo = makeRepo(BASE);
    const g = loadGraph(repo.dir);
    expect(linkFor(g, 'room#INV-1', 'LORE.md')).toBe('docs/room.md#inv-1');
    expect(linkFor(g, 'room#inv-1', 'docs/host.md')).toBe('room.md#inv-1');
    expect(linkFor(g, 'lore#DEC-1', 'docs/host.md')).toBe('../LORE.md#dec-1');
    expect(linkFor(g, 'nope#INV-1', 'LORE.md')).toBeUndefined();
  });

  test('a newer major version is L018', () => {
    repo = makeRepo({ ...BASE, 'LORE.md': BASE['LORE.md']!.replace('lore: 0.3', 'lore: 1.0') });
    expect(codes(loadGraph(repo.dir).issues)).toEqual(['L018']);
  });
});

test('the map gives the reading order', () => {
  const r = makeRepo({ ...BASE, 'LORE.md': BASE['LORE.md']!.replace('- [room](docs/room.md)\n  - [host](docs/host.md)', '- [host](docs/host.md)\n- [room](docs/room.md)') });
  try {
    const g = loadGraph(r.dir);
    expect([...g.nodes.values()].filter((n) => n.id !== 'lore').sort((a, b) => a.order - b.order).map((n) => n.id)).toEqual(['host', 'room']);
  } finally {
    r.cleanup();
  }
});

describe('diffs', () => {
  test("content lines that start with ++ or -- aren't headers; tab-suffixed paths match", async () => {
    const { parseDiff } = await import('../src/select');
    const text = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +2,3 @@',
      '+let i = 0;',
      '+++i;',
      '+i++;',
      'diff --git a/db/x.sql b/db/x.sql',
      '--- a/db/x.sql',
      '+++ b/db/x.sql',
      '@@ -4 +3,0 @@',
      `--- ${AT} room#INV-1`,
      'diff --git a/my file.ts b/my file.ts',
      '--- a/my file.ts\t',
      '+++ b/my file.ts\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    const d = parseDiff(text);
    expect([...d.changed.get('src/a.ts')!]).toEqual([2, 3, 4]);
    expect([...d.removedRefs.get('db/x.sql')!]).toEqual(['room#INV-1']);
    expect([...d.changed.get('my file.ts')!]).toEqual([1]);
  });
});
