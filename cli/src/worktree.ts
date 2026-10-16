import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './util';

/**
 * Throwaway worktrees for `bench` and `infer`: each is removed afterwards, and on SIGINT or SIGTERM,
 * so a stopped run leaves nothing behind and never touches the working tree (cli#INV-4).
 */
// @lore cli#INV-4
const active = new Map<string, string>();
let trapped = false;

function trapSignals(): void {
  if (trapped) return;
  trapped = true;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      for (const [dir, root] of active) remove(root, dir);
      process.exit(130);
    });
  }
}

function remove(root: string, dir: string): void {
  git(root, ['worktree', 'remove', '--force', dir], true);
  rmSync(dir, { recursive: true, force: true });
  active.delete(dir);
}

/** Run `fn` in a fresh detached worktree of `rev` (default HEAD), removed when it settles. */
export async function withWorktree<T>(root: string, rev: string | undefined, fn: (dir: string) => Promise<T> | T): Promise<T> {
  trapSignals();
  const dir = mkdtempSync(join(tmpdir(), 'lore-wt-'));
  rmSync(dir, { recursive: true, force: true });
  git(root, ['worktree', 'add', '--detach', '--quiet', dir, rev ?? 'HEAD']);
  active.set(dir, root);
  try {
    return await fn(dir);
  } finally {
    remove(root, dir);
  }
}
