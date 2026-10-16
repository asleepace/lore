import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadGraph } from '../src/graph';
import { review, reviewContext } from '../src/review';
import { AT, BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');
const lore = (dir: string, args: string[]) => {
  const r = spawnSync('bun', [BIN, '-C', dir, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
/** Says "broken" about the host claim when the code it's shown has the host check disabled. */
const FAKE_AGENT = `let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  console.log(s.includes('Only the host') && s.includes('if (false)') ? 'VERDICT: broken\\nThe check is disabled at src/room/room.ts:3.' : 'VERDICT: holds\\nIt holds.');
});`;

/** BASE, a decision anchored in code, and a change that disables the host check and touches the decision. */
function changed(): Repo {
  const r = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT, 'src/room/seat.ts': `// ${AT} room#DEC-1\nexport const KEEP_HOST = false;\n` });
  r.write('src/room/room.ts', BASE['src/room/room.ts']!.replace('if (from !== host)', 'if (false)'));
  r.write('src/room/seat.ts', `// ${AT} room#DEC-1\nexport const KEEP_HOST = true;\n`);
  return r;
}

describe('review', () => {
  test('reached claims come first with reasons and what rests on them; every invariant is checked when the graph is small', () => {
    // @lore cli#DEC-11
    repo = changed();
    const r = reviewContext(loadGraph(repo.dir), { range: 'HEAD' });
    expect([r.scope, r.invariants]).toEqual(['all', 3]);
    expect(r.items.map((i) => [i.ref, i.severity, i.checked])).toEqual([
      ['room#INV-1', 'high', true],
      ['room#DEC-1', 'medium', false], // a decision is context, not checked (freshness#DEC-11)
      ['room#INV-2', null, true], // not reached, checked because selection misses callers
      ['host#INV-1', null, true],
    ]);
    const inv = r.items[0]!;
    expect(inv.downstream.map((d) => [d.ref, d.via])).toEqual([['host#INV-1', 'depends on room#INV-1']]);
    expect(inv.question).toContain('Only the host can set room state');
    expect(inv.prompt).toContain('if (false)');
  });

  test('above --max invariants, or with --selected, only reached invariants are checked', () => {
    repo = changed();
    const g = loadGraph(repo.dir);
    for (const opts of [{ max: 2 }, { selectedOnly: true }]) {
      const r = reviewContext(g, { range: 'HEAD', ...opts });
      expect([r.scope, r.items.map((i) => i.ref)]).toEqual(['selected', ['room#INV-1', 'room#DEC-1']]);
    }
    for (const flags of [['--max', '2'], ['--selected']]) {
      const cli = JSON.parse(lore(repo.dir, ['review', 'HEAD', ...flags, '--json']).out) as { scope: string; range: string };
      expect([cli.scope, cli.range]).toEqual(['selected', 'HEAD']);
    }
  });

  test('with an agent: a verdict per checked claim, a trailer for those that hold, exit 1 on a break', async () => {
    repo = changed();
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const r = await review(loadGraph(repo.dir), { range: 'HEAD', agent });
    expect(r.items.map((i) => [i.ref, i.verdict ?? null])).toEqual([
      ['room#INV-1', 'broken'],
      ['room#DEC-1', null],
      ['room#INV-2', 'holds'],
      ['host#INV-1', 'holds'],
    ]);
    const out = lore(repo.dir, ['review', 'HEAD', '--agent', agent]);
    expect(out.code).toBe(1);
    expect(out.out).toContain('### ✗ broken: room#INV-1 (INV, high)');
    expect(out.out).toContain('> The check is disabled at src/room/room.ts:3.');
    expect(out.out).toContain('- **Not checked:** a decision');
    expect(out.out).toContain('### Not reached by the change: 2 of 2 invariants hold');
    expect(out.out).toContain('Lore-Verified: room#INV-2, host#INV-1');
    const piped = spawnSync('bash', ['-c', `bun ${BIN} -C ${repo.dir} review HEAD --json --agent "${agent}" | bun ${BIN} -C ${repo.dir} record verified -`], { encoding: 'utf8' });
    expect(piped.stdout).toBe('Lore-Verified: room#INV-2, host#INV-1\n');
  });

  test('without an agent: the review context, deterministic, exit 0', () => {
    repo = changed();
    const a = lore(repo.dir, ['review', 'HEAD']);
    expect(a.code).toBe(0);
    expect(a.out).toContain('- **Ask:** Does this still always hold');
    expect(a.out).toContain('### Also check (not reached by the change)\n\nroom#INV-2, host#INV-1');
    expect(lore(repo.dir, ['review', 'HEAD']).out).toBe(a.out);
    const json = JSON.parse(lore(repo.dir, ['review', 'HEAD', '--json']).out) as { items: { ref: string; prompt?: string }[] };
    expect(json.items.filter((i) => i.prompt).map((i) => i.ref)).toEqual(['room#INV-1', 'room#INV-2', 'host#INV-1']);
  });
});
