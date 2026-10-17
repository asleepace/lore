import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onStop } from './cleanup';
import { assertRev, git } from './util';

/**
 * Throwaway worktrees for `bench` and `infer`: each is removed afterwards, and on SIGINT or SIGTERM,
 * so a stopped run leaves nothing behind and never touches the working tree (cli#INV-4).
 */
// @lore cli#INV-4

function remove(root: string, dir: string): void {
  git(root, ['worktree', 'remove', '--force', dir], true);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Run `fn` in a fresh detached worktree of `rev` (default HEAD), removed when it settles or the run
 * is stopped. `fn` gets the folder matching `root` inside it, so a graph in a subfolder of the
 * repository is found where it was.
 */
export async function withWorktree<T>(root: string, rev: string | undefined, fn: (dir: string) => Promise<T> | T): Promise<T> {
  assertRev(rev);
  const prefix = git(root, ['rev-parse', '--show-prefix']).trim();
  const dir = mkdtempSync(join(tmpdir(), 'lore-wt-'));
  rmSync(dir, { recursive: true, force: true });
  git(root, ['worktree', 'add', '--detach', '--quiet', dir, rev ?? 'HEAD']);
  const off = onStop(() => remove(root, dir));
  try {
    return await fn(prefix ? join(dir, prefix) : dir);
  } finally {
    off();
    remove(root, dir);
  }
}
