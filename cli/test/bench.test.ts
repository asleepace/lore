import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { applyEdits, bench } from '../src/bench';
import { BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');

/** Says "broken" only when it's shown a disabled host check; "unsure" if it can see the cases file. */
const FAKE_AGENT = `const fs = require('fs'); let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  if (fs.existsSync('bench.json')) return console.log('VERDICT: unsure\\nI can see the answers.');
  console.log(s.includes('if (false)') ? 'VERDICT: broken\\nDisabled.' : 'VERDICT: holds\\nFine.');
});`;

const CASES = {
  cases: [
    { id: 'disable-check', ref: 'room#INV-1', expect: 'broken', edits: [{ file: 'src/room/room.ts', find: 'if (from !== host)', replace: 'if (false)' }] },
    { id: 'clean', ref: 'room#INV-1', expect: 'holds' },
    { id: 'benign-rename', ref: 'room#INV-2', expect: 'holds', edits: [{ file: 'src/room/room.ts', find: 'return { from };', replace: 'return { from: from };' }] },
    // Breaks INV-1 outside its marker region: selection can't see it, and this agent agrees wrongly.
    { id: 'off-region', ref: 'room#INV-1', expect: 'broken', edits: [{ file: 'src/room/room.ts', find: 'export function setState(from: string, host: string) {', replace: 'export function setState(from: string, host: string) {\n  host = from;' }] },
    { id: 'stale', ref: 'room#INV-1', expect: 'broken', edits: [{ file: 'src/room/room.ts', find: 'no such text', replace: '' }] },
  ],
};

describe('bench', () => {
  test('measures selection and verdicts per case, in throwaway worktrees, with the cases file hidden', async () => {
    // @lore freshness#NOTE-1
    repo = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT, 'bench.json': JSON.stringify(CASES) });
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const { results, summary } = await bench(repo.dir, join(repo.dir, 'bench.json'), { agent, jobs: 2 });
    expect(results.map((r) => [r.id, r.selected, r.verdict ?? null, r.outcome])).toEqual([
      ['disable-check', 'high', 'broken', 'caught'],
      ['clean', null, 'holds', 'ok'],
      ['benign-rename', 'high', 'holds', 'ok'],
      ['off-region', null, 'holds', 'missed'],
      ['stale', null, null, 'error'],
    ]);
    expect(results[4]!.error).toContain('not found');
    expect(summary).toMatchObject({ cases: 5, broken: 2, holds: 2, errors: 1, selected: 1, caught: 1, falseConfirmations: 1, falseAlarms: 0, unsure: 0, caughtBySelection: 1 });
    // The real tree is untouched and no worktree is left behind.
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.git('worktree', 'list').trim().split('\n').length).toBe(1);
  });

  test('without an agent only selection is measured; a false confirmation exits 1; paths are relative to -C', () => {
    repo = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT, 'bench.json': JSON.stringify(CASES) });
    // A relative cases path is read from the -C directory, as git -C would.
    const dry = spawnSync('bun', [BIN, '-C', repo.dir, 'bench', 'bench.json', '--json', '--only', 'disable-check,off-region'], { encoding: 'utf8' });
    expect(dry.status).toBe(0);
    const out = JSON.parse(dry.stdout) as { summary: { selected: number; broken: number }; results: { outcome: string }[] };
    expect([out.summary.selected, out.summary.broken, out.results.map((r) => r.outcome)]).toEqual([1, 2, ['unchecked', 'unchecked']]);
    const run = spawnSync('bun', [BIN, '-C', repo.dir, 'bench', join(repo.dir, 'bench.json'), '--agent', `node ${join(repo.dir, 'agent.cjs')}`, '--only', 'off-region'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('| off-region | room#INV-1 | broken | no | holds | missed |');
    expect(run.stdout).toContain('false confirmations 1');
  });

  test('an edit must match exactly once', () => {
    repo = makeRepo({ 'a.ts': 'x x\n' });
    expect(() => applyEdits(repo!.dir, [{ file: 'a.ts', find: 'x', replace: 'y' }])).toThrow('more than once');
    expect(() => applyEdits(repo!.dir, [{ file: 'b.ts', find: 'x', replace: 'y' }])).toThrow("doesn't exist");
  });
});
