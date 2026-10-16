import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ask, questionFor } from '../src/ask';
import { digest } from '../src/digest';
import { checkGates, trailers } from '../src/gate';
import { loadGraph } from '../src/graph';
import { history } from '../src/history';
import { diffFor, selectClaims } from '../src/select';
import { tierOf } from '../src/tiers';
import { AT, BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');
function lore(dir: string, args: string[], input?: string) {
  const r = spawnSync('bun', [BIN, '-C', dir, ...args], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const loosen = (r: Repo) =>
  r.write('src/room/room.ts', BASE['src/room/room.ts']!.replace("if (from !== host) throw new Error('not_host');", "if (false) throw new Error('not_host');"));

describe('select', () => {
  test('a change inside a marker region selects the claim at its kind severity; depends adds one hop', () => {
    // @lore freshness#INV-1, freshness#DEC-7
    repo = makeRepo(BASE);
    loosen(repo);
    const g = loadGraph(repo.dir);
    const picked = selectClaims(g, diffFor(repo.dir, 'HEAD'), { covers: false });
    expect(picked.map((p) => [p.ref, p.severity])).toEqual([
      ['room#INV-1', 'high'],
      ['host#INV-1', 'low'],
    ]);
    expect(picked[1]!.reasons).toEqual(['depends on room#INV-1']);
  });

  test('a changed same-file definition the region uses selects the claim at the region\'s severity', () => {
    // @lore freshness#DEC-9
    const code = (owner: string) => `const OWNER_ROLE = '${owner}';\n\nexport function other() {\n  return 1;\n}\n\nexport function setState(from: string, host: string) {\n  // ${AT} room#INV-1\n  if (from !== host || OWNER_ROLE !== 'host') throw new Error('not_host');\n  return true;\n}\n`;
    repo = makeRepo({ ...BASE, 'src/room/room.ts': code('host') });
    repo.write('src/room/room.ts', code('guest'));
    const picked = selectClaims(loadGraph(repo.dir), diffFor(repo.dir, 'HEAD'), { covers: false });
    expect(picked.map((p) => [p.ref, p.severity, p.reasons![0]])).toEqual([
      ['room#INV-1', 'high', 'changed OWNER_ROLE (src/room/room.ts:1), used by the marker at 8'],
      ['host#INV-1', 'low', 'depends on room#INV-1'],
    ]);
    // A change to code the region doesn't use reaches nothing.
    repo.write('src/room/room.ts', code('host').replace('return 1;', 'return 2;'));
    expect(selectClaims(loadGraph(repo.dir), diffFor(repo.dir, 'HEAD'), { covers: false })).toEqual([]);
  });

  test("a local inside another function isn't a definition, even at two spaces; a class member is", () => {
    const code = (v: string) =>
      `export function prompt() {\n  const host = '${v}';\n  return host;\n}\n\nclass Room {\n  isHost(from: string) {\n    return from === 'h';\n  }\n\n  setState(from: string, host: string) {\n    // ${AT} room#INV-1\n    if (!this.isHost(from) || from !== host) throw new Error('not_host');\n    return true;\n  }\n}\n`;
    repo = makeRepo({ ...BASE, 'src/room/room.ts': code('a') });
    repo.write('src/room/room.ts', code('b'));
    expect(selectClaims(loadGraph(repo.dir), diffFor(repo.dir, 'HEAD'), { covers: false })).toEqual([]);
    repo.write('src/room/room.ts', code('a').replace("from === 'h'", "from === 'x'"));
    expect(selectClaims(loadGraph(repo.dir), diffFor(repo.dir, 'HEAD'), { covers: false })[0]?.reasons![0]).toBe('changed isHost (src/room/room.ts:8), used by the marker at 12');
  });

  test('covered files flag every claim of the node at low severity, and only when asked', () => {
    repo = makeRepo(BASE);
    loosen(repo);
    const all = selectClaims(loadGraph(repo.dir), diffFor(repo.dir, 'HEAD'));
    expect(all.filter((p) => p.severity === 'low').map((p) => p.ref).sort()).toEqual(['host#INV-1', 'room#DEC-1', 'room#INV-2', 'room#NOTE-1']);
  });

  test('a removed marker is high severity; a moved one is not removed', () => {
    repo = makeRepo(BASE);
    repo.write('src/room/room.ts', BASE['src/room/room.ts']!.replace(`  // ${AT} room#INV-2\n`, '').replace(`// ${AT} see room#NOTE-1\n`, `// a note\n// ${AT} see room#NOTE-1\n`));
    const picked = selectClaims(loadGraph(repo.dir), diffFor(repo.dir, 'HEAD'), { covers: false });
    expect(picked.map((p) => [p.ref, p.severity, p.reasons![0]])).toEqual([['room#INV-2', 'high', 'marker removed from src/room/room.ts']]);
  });

  test('a test path changing reaches its claim at medium severity, and the claim is tested', () => {
    repo = makeRepo(BASE);
    repo.write('test/room.test.ts', '// changed\n');
    const g = loadGraph(repo.dir);
    expect(selectClaims(g, diffFor(repo.dir, 'HEAD'), { covers: false }).map((p) => [p.ref, p.severity])).toEqual([['room#INV-1', 'medium']]);
    expect(tierOf(g, g.claims.get('room#INV-1')!)).toBe('tested');
    expect(tierOf(g, g.claims.get('room#INV-2')!)).toBe('anchored');
    expect(tierOf(g, g.claims.get('host#INV-1')!)).toBe('asserted');
    expect(tierOf(g, g.claims.get('room#DEC-1')!)).toBeNull();
  });
});

describe('gates', () => {
  test('an invariant reached by a commit is unmet until acknowledged, verified or updated', () => {
    // @lore layers#DEC-6
    repo = makeRepo(BASE);
    loosen(repo);
    repo.commit('Loosen the host check');
    let r = checkGates(loadGraph(repo.dir), { range: 'HEAD~1..HEAD' });
    expect(r.results.map((x) => [x.ref, x.status])).toEqual([['room#INV-1', 'unmet']]);

    r = checkGates(loadGraph(repo.dir), { range: 'HEAD~1..HEAD', message: 'Lore-Ack: room#INV-1 (still enforced upstream)' });
    expect(r.results[0]!.status).toBe('acknowledged');

    repo.write('docs/room.md', BASE['docs/room.md']!.replace('Anyone else gets an error.', 'Anyone else gets an error, unless debug mode is on.'));
    repo.commit('Lore-Verified: room#INV-2');
    r = checkGates(loadGraph(repo.dir), { range: 'HEAD~2..HEAD' });
    expect(r.results.map((x) => [x.ref, x.status])).toEqual([['room#INV-1', 'updated']]);
  });

  test('deleting a claim heading is an unmet gate whatever the trailers say; retiring it is fine', () => {
    // @lore format#INV-2
    repo = makeRepo(BASE);
    repo.write('docs/room.md', BASE['docs/room.md']!.replace('### NOTE-1\nThe state limit counts characters, not bytes.\n\n- ask: Does the state limit count bytes?\n', ''));
    repo.commit('Drop a note\n\nLore-Ack: room#NOTE-1');
    let r = checkGates(loadGraph(repo.dir), { range: 'HEAD~1..HEAD' });
    expect(r.results.map((x) => [x.ref, x.status])).toEqual([['room#NOTE-1', 'unmet']]);
    repo.git('reset', '-q', '--hard', 'HEAD~1');
    repo.write('docs/room.md', BASE['docs/room.md']!.replace('- ask: Does the state limit count bytes?', '- ask: Does the state limit count bytes?\n- status: retired'));
    repo.commit('Retire a note');
    r = checkGates(loadGraph(repo.dir), { range: 'HEAD~1..HEAD' });
    expect(r.results).toEqual([]);
    // A heading with a title after the ID (allowed, with a warning) is caught when deleted too.
    repo.write('docs/room.md', BASE['docs/room.md']!.replace('### NOTE-1\n', '### NOTE-1 State limit\n'));
    repo.commit('Title a note');
    repo.write('docs/room.md', BASE['docs/room.md']!.replace('### NOTE-1\nThe state limit counts characters, not bytes.\n\n- ask: Does the state limit count bytes?\n', ''));
    repo.commit('Drop the titled note');
    r = checkGates(loadGraph(repo.dir), { range: 'HEAD~1..HEAD' });
    expect(r.results.map((x) => [x.ref, x.status])).toEqual([['room#NOTE-1', 'unmet']]);
  });

  test("a bot's own commits never trigger a gate", () => {
    // @lore layers#QRK-1
    repo = makeRepo(BASE);
    loosen(repo);
    repo.commit('lore: update claims', 'lore-agent[bot]');
    expect(checkGates(loadGraph(repo.dir), { range: 'HEAD~1..HEAD' }).skipped).toBe('every commit in the range is by a bot');
  });

  test('trailers take comma-separated refs and ignore reasons after them', () => {
    const t = trailers('Fix\n\nLore-Ack: room#inv-1, host#INV-1 because\nLore-Verified: room#NOTE-1');
    expect([...t.ack]).toEqual(['room#INV-1', 'host#INV-1']);
    expect([...t.verified]).toEqual(['room#NOTE-1']);
  });

  test('under gate: block an unmet gate exits 1; under warn it reports and exits 0', () => {
    repo = makeRepo(BASE);
    loosen(repo);
    repo.commit('Loosen');
    expect(lore(repo.dir, ['gate', 'HEAD~1..HEAD']).code).toBe(0);
    const blocked = lore(repo.dir, ['gate', 'HEAD~1..HEAD', '--policy', 'block']);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain('Lore-Ack: room#INV-1');
  });
});

describe('digest, ask, history', () => {
  test('digests keep first paragraphs: depth 1 is the map with leads, 2 adds statements, 3 rationale', () => {
    // @lore layers#DEC-5
    repo = makeRepo(BASE);
    const g = loadGraph(repo.dir);
    const d1 = digest(g, { depth: 1 });
    expect(d1).toBe("# Demo\n\nA demo graph for the CLI's tests.\n\n- **room** (docs/room.md): One room's rules.\n  - **host** (docs/host.md): How the host role stays on a tab that can run the game.\n");
    const d2 = digest(g, { depth: 2 });
    expect(d2).toContain('- `room#INV-1` inv: Only the host can set room state.');
    expect(d2).not.toContain('Anyone else gets an error.');
    expect(digest(g, { depth: 3 })).toContain('Anyone else gets an error.');
    expect(digest(g, { depth: 0 })).toBe("# Demo\n\nA demo graph for the CLI's tests.\n");
  });

  test('a digest for files keeps only the nodes that cover them or anchor claims in them', () => {
    repo = makeRepo({ ...BASE, 'docs/host.md': BASE['docs/host.md']!.replace('# Host', '---\ncovers: [src/host/**]\n---\n\n# Host') });
    const d = digest(loadGraph(repo.dir), { depth: 2, files: ['src/host/x.ts'] });
    expect(d).toContain('**host**');
    expect(d).not.toContain('**room**');
  });

  test('questions come from ask: or a fixed template per kind', () => {
    repo = makeRepo(BASE);
    const g = loadGraph(repo.dir);
    expect(questionFor(g.claims.get('room#NOTE-1')!)).toBe('Does the state limit count bytes?');
    expect(questionFor(g.claims.get('room#INV-1')!)).toStartWith('Does this still always hold in the code: "Only the host can set room state"?');
    expect(ask(g, [{ ref: 'room#dec-1' }, { ref: 'nope#INV-1' }]).map((r) => r.ref)).toEqual(['room#DEC-1']);
  });

  test('history finds commits that mention a claim in their message or diff, and not a longer ID', () => {
    repo = makeRepo(BASE);
    repo.write('notes.txt', 'see room#INV-1\n');
    repo.commit('Add notes');
    repo.write('other.txt', 'x\n');
    repo.commit('Tighten the check (room#INV-1)');
    repo.write('more.txt', 'room#INV-12 is different\n');
    repo.commit('Unrelated');
    const h = history(loadGraph(repo.dir), 'room#INV-1');
    expect(h.map((e) => [e.subject, e.via])).toEqual(
      expect.arrayContaining([
        ['Tighten the check (room#INV-1)', ['message']],
        ['Add notes', ['diff']],
        ['initial', ['diff']],
      ]),
    );
    expect(h.map((e) => e.subject)).not.toContain('Unrelated');
  });
});

describe('the CLI composes', () => {
  test('select --json | ask - --json, and every command speaks JSON', () => {
    // @lore cli#INV-1
    repo = makeRepo(BASE);
    loosen(repo);
    const sel = lore(repo.dir, ['select', 'HEAD', '--no-covers', '--json']);
    expect(sel.code).toBe(0);
    const asked = lore(repo.dir, ['ask', '-', '--json'], sel.out);
    const records = JSON.parse(asked.out) as { ref: string; severity: string; question: string }[];
    expect(records.map((r) => [r.ref, r.severity])).toEqual([
      ['room#INV-1', 'high'],
      ['host#INV-1', 'low'],
    ]);
    expect(records[0]!.question).toContain('Only the host can set room state');
    for (const args of [['lint'], ['digest', '--depth', '2'], ['history', 'room#INV-1'], ['record', 'verified', 'room#INV-1'], ['link', 'room#INV-1'], ['gate', 'HEAD']]) {
      const r = lore(repo.dir, [...args, '--json']);
      expect(() => JSON.parse(r.out)).not.toThrow();
    }
    // Every command that takes claims reads them from stdin given `-`, one group per claim.
    for (const cmd of ['ask', 'show', 'trace', 'history', 'link', 'record verified']) {
      const r = lore(repo.dir, [...cmd.split(' '), '-', '--json'], sel.out);
      expect([cmd, r.code]).toEqual([cmd, 0]);
      expect(r.out).toContain('room#INV-1');
    }
    const links = JSON.parse(lore(repo.dir, ['link', '-', '--json'], 'room#INV-1\nhost#INV-1\n').out) as { ref: string; link: string }[];
    expect(links).toEqual([{ ref: 'room#INV-1', link: 'docs/room.md#inv-1' }, { ref: 'host#INV-1', link: 'docs/host.md#inv-1' }]);
  });

  test('plain ref lists on stdin work too, and record prints trailers', () => {
    repo = makeRepo(BASE);
    expect(lore(repo.dir, ['ask', '-'], 'room#INV-1\nroom#DEC-1\n').out).toContain('room#DEC-1');
    expect(lore(repo.dir, ['record', 'ack', 'room#inv-1', 'host#INV-1']).out).toBe('Lore-Ack: room#INV-1, host#INV-1\n');
  });

  test('lint exits 1 on errors and 0 otherwise; usage errors exit 2', () => {
    repo = makeRepo(BASE);
    expect(lore(repo.dir, ['lint']).code).toBe(0);
    repo.write('docs/bad.md', '# Bad\n\nRefers to room#INV-99.\n');
    expect(lore(repo.dir, ['lint']).code).toBe(1);
    expect(lore(repo.dir, ['nope']).code).toBe(2);
    expect(lore(repo.dir, ['digest', '--depth', '7']).code).toBe(2);
  });

  test('the review date is an input: the same repository and date always lint the same', () => {
    // @lore cli#INV-3
    repo = makeRepo({ ...BASE, 'docs/host.md': BASE['docs/host.md']! + '- review_after: 2026-12-01\n' });
    expect(lore(repo.dir, ['--today', '2026-11-30', 'lint']).out).not.toContain('L008');
    expect(lore(repo.dir, ['--today', '2026-12-02', 'lint']).out).toContain('L008 host#INV-1');
    const env = { ...process.env, LORE_TODAY: '2026-12-02' };
    expect(spawnSync('bun', [BIN, '-C', repo.dir, 'lint'], { encoding: 'utf8', env }).stdout).toContain('L008');
  });

  test('select, lint, digest and gate need no model and give the same answer every run', () => {
    // @lore cli#INV-3
    repo = makeRepo(BASE);
    loosen(repo);
    for (const args of [['select', 'HEAD', '--json'], ['lint', '--json'], ['digest', '--depth', '3'], ['gate', 'HEAD', '--json']]) {
      const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
      const a = spawnSync('bun', [BIN, '-C', repo.dir, ...args], { encoding: 'utf8', env });
      const b = spawnSync('bun', [BIN, '-C', repo.dir, ...args], { encoding: 'utf8', env });
      expect(a.stdout).toBe(b.stdout);
    }
  });
});
