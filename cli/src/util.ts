import { execFileSync } from 'node:child_process';

/** `**` any path, `*` any run within a segment, `?` one character. Globs are repository-relative. */
export function globToRegExp(glob: string): RegExp {
  let rx = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      rx += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (ch === '*') rx += '[^/]*';
    else if (ch === '?') rx += '[^/]';
    else rx += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${rx}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

export function git(cwd: string, args: string[], allowFail = false): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (allowFail) return '';
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args.join(' ')}: ${(e.stderr ?? e.message).trim()}`);
  }
}

/** Files git knows about (tracked and untracked, ignoring .gitignore'd ones). */
export function repoFiles(cwd: string): string[] {
  return git(cwd, ['ls-files', '-co', '--exclude-standard'], true).split('\n').filter(Boolean);
}

/** Lines of a split paragraph list, without fenced code. Inline code is blanked so it never counts as a reference or marker. */
export function stripCode(text: string): string {
  return text
    .replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

/** `room#inv-2` → `room#INV-2`; node part lowercase, claim part uppercase. */
export function normalizeRef(ref: string): string {
  const [node = '', claim] = ref.trim().split('#');
  const n = node.toLowerCase() === 'app' ? 'lore' : node.toLowerCase();
  return claim ? `${n}#${claim.toUpperCase()}` : n;
}

export const PREFIXES = ['INV', 'DEC', 'NOTE', 'LIM', 'QRK', 'EDGE', 'PLAN'] as const;
export const REF_RX = new RegExp(`\\b([a-z][a-z0-9-]*)#((?:${PREFIXES.join('|')})-\\d+)\\b`, 'gi');
