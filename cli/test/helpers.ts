import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Fixture markers are built from pieces so the literal never appears here, or `lore lint` on this repo would read them as real anchors. */
export const AT = '@' + 'lore';

export interface Repo {
  dir: string;
  write(path: string, text: string): void;
  commit(message: string, author?: string): string;
  git(...args: string[]): string;
  cleanup(): void;
}

/** A throwaway git repository with the given files committed. */
export function makeRepo(files: Record<string, string>): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'lore-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-16T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-16T12:00:00Z' },
    });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string, author?: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message, ...(author ? ['--author', `${author} <bot@example.com>`] : []));
    return git('rev-parse', 'HEAD').trim();
  };
  for (const [p, t] of Object.entries(files)) write(p, t);
  commit('initial');
  return { dir, write, commit, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A small v0.3 graph: a root, a parent and a child node, code with markers, a test. */
export const BASE: Record<string, string> = {
  'LORE.md': `---
lore: 0.3
nodes: [docs]
gate: warn
---

# Demo

A demo graph for the CLI's tests.

## Map

- [room](docs/room.md)
  - [host](docs/host.md)
`,
  'docs/room.md': `---
covers: [src/room/**]
verified: 2026-10-16
---

# Room

One room's rules.

## Invariants

### INV-1
Only the host can set room state.

Anyone else gets an error.

- tests: test/room.test.ts

### INV-2
Every relayed message carries the sender the room saw.

## Decisions

### DEC-1
A returning ex-host doesn't take the role back.

Rejected: restoring the old host.

## Notes

### NOTE-1
The state limit counts characters, not bytes.

- ask: Does the state limit count bytes?
`,
  'docs/host.md': `# Host

How the host role stays on a tab that can run the game.

## Invariants

### INV-1
A silent host is replaced when someone else is connected.

- depends: room#INV-1
`,
  'src/room/room.ts': `export function setState(from: string, host: string) {
  // ${AT} room#INV-1
  if (from !== host) throw new Error('not_host');
  return true;
}

export function relay(from: string) {
  // ${AT} room#INV-2
  return { from };
}

// ${AT} see room#NOTE-1
export const LIMIT = 65536;
`,
  'test/room.test.ts': `// a test file\n`,
};
