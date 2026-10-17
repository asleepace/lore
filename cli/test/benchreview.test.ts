import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { benchReview } from '../src/benchreview';
import { BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');

/** Triage flags room#INV-2 when the diff adds relayAs; the check calls it broken when the diff takes `from` from the frame. */
const FAKE_AGENT = `let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  if (s.includes('You are triaging')) return console.log(s.includes('relayAs') ? 'AFFECTS: room#INV-2: a new path builds messages' : 'AFFECTS: none');
  const claim = (s.match(/Claim: (\\S+),/) || [])[1];
  console.log(claim === 'room#INV-2' && s.includes('from: frame.from') ? 'VERDICT: broken\\nfrom comes from the frame.' : 'VERDICT: holds\\nIt holds.');
});`;

const PATCH = `diff --git a/src/room/relay2.ts b/src/room/relay2.ts
new file mode 100644
--- /dev/null
+++ b/src/room/relay2.ts
@@ -0,0 +1,3 @@
+export function relayAs(frame: { from: string; d: unknown }) {
+  return { from: frame.from, d: frame.d };
+}
`;

describe('bench --review', () => {
  test('feature-sized cases from a patch: triage finds the claim, the review is scored across the whole graph', async () => {
    // @lore cli#DEC-14
    repo = makeRepo({
      ...BASE,
      'agent.cjs': FAKE_AGENT,
      'eval/relay.patch': PATCH,
      'eval/cases.json': JSON.stringify({
        cases: [
          { id: 'new-path', patch: 'relay.patch', expect: { 'room#INV-2': 'broken' } },
          { id: 'clean', expect: {} },
        ],
      }),
    });
    const agent = `node ${join(repo.dir, 'agent.cjs')}`;
    const { results, summary } = await benchReview(repo.dir, join(repo.dir, 'eval/cases.json'), { agent });
    expect(results.map((r) => [r.id, r.caught, r.missed, r.falseAlarms, r.calls])).toEqual([
      ['new-path', ['room#INV-2'], [], [], 2],
      ['clean', [], [], [], 0], // no diff, nothing to triage or check
    ]);
    expect([summary.caught, summary.expectedBreaks, summary.falseAlarms]).toEqual([1, 1, 0]);
    // Selection alone never reaches the new path: the miss is reported as triage-free "not checked".
    const sel = await benchReview(repo.dir, join(repo.dir, 'eval/cases.json'), { agent, scope: 'selected', only: ['new-path'] });
    expect([sel.results[0]!.missed, sel.summary.missedByTriage]).toEqual([[{ ref: 'room#INV-2', got: 'not checked' }], 1]);
    // The CLI: a table, and exit 1 when an expected break is missed.
    const cli = spawnSync('bun', [BIN, '-C', repo.dir, 'bench', 'eval/cases.json', '--review', '--selected', '--agent', agent], { encoding: 'utf8' });
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain('| new-path | room#INV-2 | – | room#INV-2 (not checked) | – | – | 0 |');
    expect(repo.git('worktree', 'list').trim().split('\n').length).toBe(1);
  });
});
