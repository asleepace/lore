import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadGraph } from '../src/graph';
import { combine, infer, parseInferVerdict } from '../src/infer';
import { BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');

/**
 * Stands in for a model on both steps. Blind: reports a leak if the graph is readable from where it
 * runs, says what the host check does if it's shown one, and "unknown" otherwise. Grading: inferred
 * when both the claim and the answer state the host rule.
 */
const FAKE_AGENT = `const fs = require('fs');
let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  if (s.includes('Compare their answer')) {
    const answer = s.split('Their answer:')[1] || '';
    const claim = (s.match(/Claim \\([^)]*\\): (.*)/) || [])[1] || '';
    console.log(/only the host/i.test(claim) && /only the host/i.test(answer) ? 'VERDICT: inferred\\nSame rule.' : 'VERDICT: missed\\nNothing like it.');
    return;
  }
  if (fs.existsSync('LORE.md') || fs.existsSync('docs') || /@lore|room#INV/.test(s)) { console.log('LEAK'); return; }
  console.log(s.includes('not_host') ? 'Only the host may set state; anyone else gets not_host.' : 'unknown');
});`;

describe('infer', () => {
  test('blind prompts show the code where a claim is anchored, with no graph text, refs or markers', async () => {
    // @lore cli#DEC-12
    repo = makeRepo(BASE);
    const { results } = await infer(loadGraph(repo.dir));
    expect(results.map((r) => [r.ref, r.located])).toEqual([
      ['room#INV-1', 'code'],
      ['room#INV-2', 'code'],
      ['room#DEC-1', 'covers'],
      ['room#NOTE-1', 'covers'], // a `see` marker doesn't anchor
      ['host#INV-1', 'topic'],
    ]);
    const p = results[0]!.blindPrompt;
    expect(p).toContain("if (from !== host) throw new Error('not_host');");
    expect(p).toContain('What property must this code always preserve');
    for (const leak of ['Only the host can set room state', 'room#INV-1', '@lore']) expect(p).not.toContain(leak);
    expect(results[4]!.blindPrompt).toContain('The area: Host');
    // The worktree is gone and the working tree untouched (cli#INV-4).
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.git('worktree', 'list').trim().split('\n').length).toBe(1);
  });

  test('with an agent: blind in a tree without the graph, then graded; the summary counts by kind', async () => {
    repo = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT });
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const { results, summary } = await infer(loadGraph(repo.dir), { agent, jobs: 2 });
    expect(results.some((r) => r.blind === 'LEAK')).toBe(false);
    expect(results.map((r) => [r.ref, r.verdict])).toEqual([
      ['room#INV-1', 'inferred'],
      ['room#INV-2', 'missed'],
      ['room#DEC-1', 'missed'],
      ['room#NOTE-1', 'missed'],
      ['host#INV-1', 'missed'],
    ]);
    expect([summary.inferred, summary.byKind.INV]).toEqual([['room#INV-1'], { inferred: 1, partial: 0, missed: 2, unsure: 0 }]);
    const out = spawnSync('bun', [BIN, '-C', repo.dir, 'infer', '--agent', agent, '--kind', 'INV'], { encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('| room#INV-1 | INV | code | inferred | Only the host may set state; anyone else gets not_host. |');
    expect(out.stdout).toContain('1 of 3 claims inferred from the code alone; 0 partly.');
    expect(out.stdout).toContain('Restate the code (candidates to cut, or to rewrite with the why): room#INV-1');
  });

  test('--code-only deletes every markdown file too; verdicts default to unsure', async () => {
    repo = makeRepo({ ...BASE, 'NOTES.md': 'Only the host can set room state.\n', 'agent.cjs': FAKE_AGENT.replace("fs.existsSync('docs')", "fs.existsSync('docs') || fs.existsSync('NOTES.md')") });
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const { results } = await infer(loadGraph(repo.dir), { agent, codeOnly: true, refs: ['room#INV-1'] });
    expect(results.map((r) => [r.ref, r.verdict])).toEqual([['room#INV-1', 'inferred']]);
    expect(parseInferVerdict('VERDICT: Partial\nvaguer')).toBe('partial');
    expect(parseInferVerdict('maybe')).toBe('unsure');
    // Over several runs, the least inferable verdict stands.
    expect([combine(['inferred', 'inferred']), combine(['inferred', 'partial']), combine(['inferred', 'unsure']), combine(['unsure', 'missed'])]).toEqual(['inferred', 'partial', 'unsure', 'missed']);
    const twice = await infer(loadGraph(repo.dir), { agent, codeOnly: true, refs: ['room#INV-1'], runs: 2 });
    expect([twice.results[0]!.verdict, twice.results[0]!.runs]).toEqual(['inferred', ['inferred', 'inferred']]);
  });
});
