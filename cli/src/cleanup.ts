/**
 * What to undo if the run is stopped (SIGINT, SIGTERM): worktrees to remove, agents to kill. One
 * handler for all of them, so each runs before the process exits (cli#INV-4).
 */
const tasks = new Set<() => void>();
let trapped = false;

export function onStop(task: () => void): () => void {
  if (!trapped) {
    trapped = true;
    // SIGHUP too: agents run in their own process group, so a closed terminal no longer reaches them.
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.once(sig, () => {
        // Newest first: agents (started inside a worktree) die before the worktree is removed.
        for (const t of [...tasks].reverse()) {
          try {
            t();
          } catch {
            // keep undoing the rest
          }
        }
        process.exit(130);
      });
    }
  }
  tasks.add(task);
  return () => tasks.delete(task);
}
