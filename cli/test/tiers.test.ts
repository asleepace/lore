import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadGraph } from '../src/graph';
import { tierOf } from '../src/tiers';
import { normalizeRef } from '../src/util';
import { BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());

const tier = (dir: string, ref: string) => {
  const g = loadGraph(dir);
  return tierOf(g, g.claims.get(normalizeRef(ref))!);
};
const l024 = (dir: string) => loadGraph(dir).issues.filter((i) => i.code === 'L024');

// @lore freshness#INV-2
describe('tests: and files: paths must exist', () => {
  test('an existing tests: path makes an invariant tested, with no L024', () => {
    repo = makeRepo(BASE);
    expect(tier(repo.dir, 'room#INV-1')).toBe('tested');
    expect(l024(repo.dir)).toEqual([]);
  });

  test('a deleted test drops the tier to what still backs the claim, and lint says why', () => {
    repo = makeRepo(BASE);
    rmSync(join(repo.dir, 'test/room.test.ts'));
    expect(tier(repo.dir, 'room#INV-1')).toBe('anchored'); // its marker in src/room/room.ts remains
    expect(l024(repo.dir)).toEqual([{ code: 'L024', level: 'error', where: 'room#INV-1', message: "tests: test/room.test.ts doesn't exist" }]);
  });

  test('a files: path anchors a claim only while the file exists', () => {
    const files = { ...BASE };
    files['docs/host.md'] = files['docs/host.md']!.replace('- depends: room#INV-1', '- depends: room#INV-1\n- files: config/host.json');
    repo = makeRepo({ ...files, 'config/host.json': '{}\n' });
    expect(tier(repo.dir, 'host#INV-1')).toBe('anchored');
    rmSync(join(repo.dir, 'config/host.json'));
    expect(tier(repo.dir, 'host#INV-1')).toBe('asserted');
    expect(l024(repo.dir).map((i) => i.message)).toEqual(["files: config/host.json doesn't exist"]);
  });

  test('retired claims may point at deleted paths', () => {
    const files = { ...BASE };
    files['docs/room.md'] = files['docs/room.md']!.replace('- tests: test/room.test.ts', '- tests: test/gone.test.ts\n- status: retired');
    repo = makeRepo(files);
    expect(l024(repo.dir)).toEqual([]);
  });
});
