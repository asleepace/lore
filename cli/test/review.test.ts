import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadGraph } from '../src/graph';
import { parseVerdict } from '../src/check';
import { parseTriage, review, reviewContext } from '../src/review';
import { AT, BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');
const lore = (dir: string, args: string[]) => {
  const r = spawnSync('bun', [BIN, '-C', dir, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
/**
 * Stands in for a model on both steps. Triage: flags room#INV-2 when the diff adds `relayAs`, else
 * nothing (and fails outright when the diff says FAIL_TRIAGE). Check: "broken" for the host claim
 * when the host check is disabled, and for room#INV-2 when the diff takes `from` from the frame.
 */
const FAKE_AGENT = `let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  if (s.includes('You are triaging')) {
    if (s.includes('FAIL_TRIAGE')) process.exit(3);
    console.log(s.includes('relayAs') ? 'AFFECTS: room#INV-2: relayAs builds a message from the frame' : 'AFFECTS: none');
    return;
  }
  const claim = (s.match(/Claim: (\\S+),/) || [])[1];
  if (claim === 'room#INV-1' && s.includes('if (false)')) return console.log('VERDICT: broken\\nThe check is disabled at src/room/room.ts:3.');
  if (claim === 'room#INV-2' && s.includes('from: frame.from')) return console.log('VERDICT: broken\\nrelayAs takes the sender from the frame (src/room/relay2.ts:2).');
  console.log('VERDICT: holds\\nIt holds.');
});`;

/** BASE, a decision anchored in code, and a change that disables the host check and touches the decision. */
function changed(): Repo {
  const r = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT, 'src/room/seat.ts': `// ${AT} room#DEC-1\nexport const KEEP_HOST = false;\n` });
  r.write('src/room/room.ts', BASE['src/room/room.ts']!.replace('if (from !== host)', 'if (false)'));
  r.write('src/room/seat.ts', `// ${AT} room#DEC-1\nexport const KEEP_HOST = true;\n`);
  return r;
}

/** BASE and a change that adds a new, unmarked path taking the sender from the frame: selection reaches nothing. */
function newPath(extra = ''): Repo {
  const r = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT });
  r.write('src/room/relay2.ts', `export function relayAs(frame: { from: string; d: unknown }) {\n  return { from: frame.from, d: frame.d };\n}\n${extra}`);
  r.git('add', '-A');
  return r;
}

describe('review', () => {
  test('without a model: reached claims first, then every invariant, each prompt asking whether this change breaks it', () => {
    // @lore cli#DEC-11
    repo = changed();
    const r = reviewContext(loadGraph(repo.dir), { range: 'HEAD' });
    expect([r.scope, r.invariants]).toEqual(['all', 3]);
    expect(r.items.map((i) => [i.ref, i.severity, i.checked])).toEqual([
      ['room#INV-1', 'high', true],
      ['room#DEC-1', 'medium', false], // a decision is context, not checked (freshness#DEC-11)
      ['room#INV-2', null, true],
      ['host#INV-1', null, true],
    ]);
    const inv = r.items[0]!;
    expect(inv.downstream.map((d) => [d.ref, d.via])).toEqual([['host#INV-1', 'depends on room#INV-1']]);
    expect(inv.prompt).toContain('does this change break it?');
    expect(inv.prompt).toContain("-  if (from !== host) throw new Error('not_host');");
    expect(inv.prompt).toContain('VERDICT: preexisting');
    const selected = reviewContext(loadGraph(repo.dir), { range: 'HEAD', scope: 'selected' });
    expect(selected.items.map((i) => i.ref)).toEqual(['room#INV-1', 'room#DEC-1']);
    const cli = JSON.parse(lore(repo.dir, ['review', 'HEAD', '--selected', '--json']).out) as { scope: string; range: string };
    expect([cli.scope, cli.range]).toEqual(['selected', 'HEAD']);
  });

  test('triage finds a break in a new path no marker covers, and the check judges the change, not the marked code', async () => {
    // @lore cli#DEC-13, layers#DEC-8
    repo = newPath();
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const r = await review(loadGraph(repo.dir), { range: 'HEAD', agent });
    expect(r.items.map((i) => [i.ref, i.severity, i.triage, i.verdict])).toEqual([['room#INV-2', null, 'relayAs builds a message from the frame', 'broken']]);
    expect([r.scope, r.calls]).toEqual(['triage', 2]); // one triage, one check, not one per invariant
    const out = lore(repo.dir, ['review', 'HEAD', '--agent', agent]);
    expect(out.code).toBe(1);
    expect(out.out).toContain('triage read the change against all 3 invariants and flagged 1');
    expect(out.out).toContain('- **Flagged by triage:** relayAs builds a message from the frame');
    expect(out.out).toContain('2 invariants not flagged by triage, so not checked.');
  });

  test('--all checks every invariant against the change; a trailer for those that hold; exit 1 on a break', async () => {
    repo = changed();
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const r = await review(loadGraph(repo.dir), { range: 'HEAD', agent, scope: 'all' });
    expect(r.items.map((i) => [i.ref, i.verdict ?? null])).toEqual([
      ['room#INV-1', 'broken'],
      ['room#DEC-1', null],
      ['room#INV-2', 'holds'],
      ['host#INV-1', 'holds'],
    ]);
    expect(r.calls).toBe(3);
    const out = lore(repo.dir, ['review', 'HEAD', '--all', '--agent', agent]);
    expect(out.code).toBe(1);
    expect(out.out).toContain('### ✗ broken: room#INV-1 (INV, high)');
    expect(out.out).toContain('> The check is disabled at src/room/room.ts:3.');
    expect(out.out).toContain('- **Not checked:** a decision');
    expect(out.out).toContain('### Checked against the change and holding: room#INV-2, host#INV-1');
    const piped = spawnSync('bash', ['-c', `bun ${BIN} -C ${repo.dir} review HEAD --all --json --agent "${agent}" | bun ${BIN} -C ${repo.dir} record verified -`], { encoding: 'utf8' });
    expect(piped.stdout).toBe('Lore-Verified: room#INV-2, host#INV-1\n');
  });

  test('a failed triage checks every invariant rather than none; triage answers parse leniently', async () => {
    repo = newPath('// FAIL_TRIAGE\n');
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const r = await review(loadGraph(repo.dir), { range: 'HEAD', agent });
    expect([r.triageFallback, r.items.filter((i) => i.checked).length, r.calls]).toEqual([true, 3, 4]);
    expect(r.items.find((i) => i.ref === 'room#INV-2')!.verdict).toBe('broken');
    expect([...parseTriage('Sure.\n- AFFECTS: room#INV-2: reason one\n**AFFECTS:** host#INV-1 — reason two\n')!]).toEqual([
      ['room#INV-2', 'reason one'],
      ['host#INV-1', 'reason two'],
    ]);
    expect(parseTriage('AFFECTS: none')!.size).toBe(0);
    expect(parseTriage('I think nothing breaks.')).toBeNull();
    expect(parseVerdict('VERDICT: preexisting\nIt was already like this.')).toBe('preexisting');
  });
});
