import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadGraph } from '../src/graph';
import { edges, find, show, showNode, trace } from '../src/query';
import { AT, BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');
function lore(dir: string, args: string[], input?: string) {
  const r = spawnSync('bun', [BIN, '-C', dir, ...args], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** BASE plus prose references, a retired claim and two markers on adjacent blocks. */
function linked(): Repo {
  return makeRepo({
    ...BASE,
    'docs/host.md': `# Host

How the host role stays on a tab that can run the game.

## Invariants

### INV-1
A silent host is replaced when someone else is connected.

Election follows [room#DEC-1](room.md#dec-1).

- depends: room#INV-1

## Notes

### NOTE-1
The silence window doubles after a quick replacement.

It exists because of INV-1.

### NOTE-2
An old window rule.

- status: retired
- superseded_by: host#NOTE-1
`,
    'src/room/room.ts': BASE['src/room/room.ts']!.replace(`  // ${AT} room#INV-2\n  return { from };`, `  // ${AT} room#INV-2\n  return { from };\n\n  // ${AT} room#DEC-1\n  return null;`),
  });
}

describe('edges', () => {
  test('come from depends, prose references (full and local), superseded_by, and adjacent code', () => {
    // @lore format#DEC-13
    repo = linked();
    const e = edges(loadGraph(repo.dir)).map((x) => `${x.from} ${x.rel} ${x.to}`);
    expect(e).toContain('host#INV-1 depends room#INV-1');
    expect(e).toContain('host#INV-1 mentions room#DEC-1');
    expect(e).toContain('host#NOTE-1 mentions host#INV-1');
    expect(e).toContain('host#NOTE-2 superseded_by host#NOTE-1');
    expect(e).toContain('room#INV-2 same-code room#DEC-1');
    expect(e).toContain('room#DEC-1 same-code room#INV-2');
    // INV-1 and INV-2 are in the same file but separate blocks: not the same code.
    expect(e).not.toContain('room#INV-1 same-code room#INV-2');
  });
});

describe('trace', () => {
  test('down: what rests on a claim, hop by hop, each reached once at its nearest hop', () => {
    repo = linked();
    const { rows } = trace(loadGraph(repo.dir), ['room#INV-1']);
    expect(rows.map((r) => [r.hop, r.ref, r.via])).toEqual([
      [0, 'room#INV-1', 'start'],
      [1, 'host#INV-1', 'depends on room#INV-1'],
      [2, 'host#NOTE-1', 'mentions host#INV-1'],
    ]);
  });

  test('up: what a claim rests on; depth bounds the walk; inactive claims only when asked', () => {
    repo = linked();
    const g = loadGraph(repo.dir);
    expect(trace(g, ['host#NOTE-1'], { direction: 'up' }).rows.map((r) => [r.hop, r.ref])).toEqual([
      [0, 'host#NOTE-1'],
      [1, 'host#INV-1'],
      [2, 'room#INV-1'],
      [2, 'room#DEC-1'],
    ]);
    expect(trace(g, ['host#NOTE-1'], { direction: 'up', depth: 1 }).rows.map((r) => r.ref)).toEqual(['host#NOTE-1', 'host#INV-1']);
    expect(trace(g, ['host#NOTE-1']).rows.map((r) => r.ref)).toEqual(['host#NOTE-1']);
    expect(trace(g, ['host#NOTE-1'], { inactive: true }).rows.map((r) => [r.ref, r.via])).toEqual([
      ['host#NOTE-1', 'start'],
      ['host#NOTE-2', 'superseded by host#NOTE-1'],
    ]);
  });

  test('a file starts from every claim anchored in it; shared code is one hop and never walked', () => {
    repo = linked();
    const g = loadGraph(repo.dir);
    const fromFile = trace(g, ['src/room/room.ts'], { depth: 1 }).rows;
    expect(fromFile.filter((r) => r.hop === 0).map((r) => [r.ref, r.via])).toEqual([
      ['room#INV-1', `marker at src/room/room.ts:2`],
      ['room#INV-2', `marker at src/room/room.ts:8`],
      ['room#DEC-1', `marker at src/room/room.ts:11`],
      ['room#NOTE-1', `see marker at src/room/room.ts:15`],
    ]);
    const fromDec = trace(g, ['room#DEC-1']).rows.map((r) => [r.hop, r.ref, r.rel ?? 'start']);
    expect(fromDec).toEqual([
      [0, 'room#DEC-1', 'start'],
      [1, 'host#INV-1', 'mentions'],
      [1, 'room#INV-2', 'same-code'],
      [2, 'host#NOTE-1', 'mentions'],
    ]);
    expect(trace(g, ['room#DEC-1'], { code: false }).rows.map((r) => r.ref)).not.toContain('room#INV-2');
    expect(trace(g, ['src/room/']).rows.length).toBe(trace(g, ['src/room/room.ts']).rows.length);
    expect(trace(g, ['src/**/*.ts']).rows.length).toBe(trace(g, ['src/room/room.ts']).rows.length);
  });

  test("markers on adjacent lines of markdown aren't shared code; a node's file starts from the node", () => {
    repo = linked();
    repo.write('NOTES.md', `- one <!-- ${AT} room#INV-1 -->\n- two <!-- ${AT} host#NOTE-1 -->\n`);
    repo.git('add', '-A');
    const g = loadGraph(repo.dir);
    expect(edges(g).filter((e) => e.rel === 'same-code' && e.file!.startsWith('NOTES.md'))).toEqual([]);
    expect(trace(g, ['docs/host.md']).rows.map((r) => r.ref)).toEqual(trace(g, ['host']).rows.map((r) => r.ref));
  });

  test('cycles end: two claims that mention each other are each listed once', () => {
    repo = linked();
    repo.write('docs/room.md', BASE['docs/room.md']!.replace('Anyone else gets an error.', 'Anyone else gets an error; see DEC-1.').replace('Rejected: restoring the old host.', 'Follows from INV-1.\nRejected: restoring the old host.'));
    const rows = trace(loadGraph(repo.dir), ['room#INV-1'], { direction: 'both' }).rows;
    expect(rows.filter((r) => r.ref === 'room#DEC-1').length).toBe(1);
    expect(rows.filter((r) => r.ref === 'room#INV-1').length).toBe(1);
  });
});

describe('show and find', () => {
  test('show gives a claim with its anchors and every edge; a node with its children and claims', () => {
    repo = linked();
    const g = loadGraph(repo.dir);
    const s = show(g, 'room#inv-1')!;
    expect(s.at).toBe('docs/room.md:12');
    expect(s.tier).toBe('tested');
    expect(s.anchors.map((a) => `${a.file}:${a.line ?? a.via}`)).toEqual(['src/room/room.ts:2', 'test/room.test.ts:tests']);
    expect(s.edges.dependedOnBy).toEqual(['host#INV-1']);
    const d = show(g, 'room#DEC-1')!;
    expect(d.edges.mentionedBy).toEqual(['host#INV-1']);
    expect(d.edges.sameCode).toEqual(['room#INV-2 (src/room/room.ts:8)']);
    expect(show(g, 'room#INV-9')).toBeNull();
    const n = showNode(g, 'room')!;
    expect([n.parent, n.children, n.claims.length]).toEqual(['lore', ['host'], 4]);
  });

  test('find filters by words, kind, node subtree, file and tier, in map order', () => {
    repo = linked();
    const g = loadGraph(repo.dir);
    expect(find(g, { kinds: ['INV'] }).map((r) => r.ref)).toEqual(['room#INV-1', 'room#INV-2', 'host#INV-1']);
    expect(find(g, { node: 'room', kinds: ['INV'] }).map((r) => r.ref)).toEqual(['room#INV-1', 'room#INV-2', 'host#INV-1']);
    expect(find(g, { node: 'host' }).map((r) => r.ref)).toEqual(['host#INV-1', 'host#NOTE-1']);
    expect(find(g, { text: ['HOST', 'replaced'] }).map((r) => r.ref)).toEqual(['host#INV-1']);
    expect(find(g, { file: 'src/room/room.ts', kinds: ['DEC'] }).map((r) => r.ref)).toEqual(['room#DEC-1']);
    expect(find(g, { tier: 'asserted' }).map((r) => r.ref)).toEqual(['host#INV-1']);
    expect(find(g, { text: ['old window'], inactive: true }).map((r) => r.ref)).toEqual(['host#NOTE-2']);
  });

  test('CLI: a markdown table for people, records that pipe into ask and trace', () => {
    // @lore cli#INV-1
    repo = linked();
    const table = lore(repo.dir, ['trace', 'room#INV-1']);
    expect(table.code).toBe(0);
    expect(table.out.split('\n').slice(0, 3)).toEqual([
      '| Hop | Claim | Relation | Statement |',
      '|---|---|---|---|',
      '| 0 | room#INV-1 | start | Only the host can set room state. |',
    ]);
    const found = lore(repo.dir, ['find', '--kind', 'INV', '--node', 'host', '--json']);
    const asked = lore(repo.dir, ['ask', '-', '--json'], found.out);
    expect((JSON.parse(asked.out) as { ref: string }[]).map((r) => r.ref)).toEqual(['host#INV-1']);
    const traced = lore(repo.dir, ['trace', '-', '--up', '--json'], found.out);
    expect((JSON.parse(traced.out) as { ref: string }[]).map((r) => r.ref)).toEqual(['host#INV-1', 'room#INV-1', 'room#DEC-1']);
    expect(lore(repo.dir, ['show', 'nope#INV-1']).code).toBe(2);
    expect(lore(repo.dir, ['find', '--kind', 'LIM']).code).toBe(2);
    expect(lore(repo.dir, ['show', 'room#DEC-1']).out).toContain('same code: room#INV-2 (src/room/room.ts:8)');
  });
});
