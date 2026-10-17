/**
 * Top-level definitions a marker region uses from elsewhere in its file: the constant a check
 * compares with, the helper it calls. A change there changes what the region means without touching
 * it (freshness#NOTE-2), so `select` reaches the claim and `check` shows the definition.
 *
 * A heuristic for JavaScript-like languages, and deterministic: same file only, top level or
 * members of a top-level class (one indent level in), names of three characters or more, never
 * another object's property (`x.name`) or a local inside a function.
 */

const MAX_DEFINITION_LINES = 20;
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'super', 'this', 'new', 'typeof', 'await']);
const DEFINES =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]|(?:(?:private|public|protected|static|readonly|async|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]*)?\{\s*$)/;

export interface Definition {
  name: string;
  /** 1-based, including up to three comment lines above it. */
  start: number;
  end: number;
}

/**
 * Definitions of names used in lines `from`..`to`, in order of first use. Definitions starting
 * inside `skipFrom`..`skipTo` (default: the region) are left out, being already in view.
 */
// @lore freshness#DEC-9, freshness#NOTE-2
export function definitionsUsed(lines: string[], from: number, to: number, opts: { skipFrom?: number; skipTo?: number } = {}): Definition[] {
  const skipFrom = opts.skipFrom ?? from;
  const skipTo = opts.skipTo ?? to;
  const used = lines.slice(from - 1, to).join('\n').replace(/\/\/.*$/gm, '');
  const names = new Map<string, number>();
  for (const m of used.matchAll(/#?[A-Za-z_$][\w$]*/g)) {
    // A bare name, or a member of `this`; `x.name` is some other object's property.
    const before = used.slice(Math.max(0, m.index! - 5), m.index!);
    if (/[\w$]$/.test(before) || (before.endsWith('.') && !before.endsWith('this.'))) continue;
    if (m[0].replace('#', '').length >= 3 && !names.has(m[0])) names.set(m[0], m.index!);
  }
  const found: (Definition & { at: number })[] = [];
  // What the last top-level line opened: a class body holds members at the next indent, while
  // anything indented under a function or a call is a local.
  let inClass = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    const indent = /^\s*/.exec(line)![0].length;
    if (indent === 0 && line.trim() && !/^[}\])]/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) inClass = /\bclass\b/.test(line);
    if (n >= skipFrom && n <= skipTo) return;
    if (indent > 2 || (indent > 0 && !inClass)) return; // top level or a class member, not a local
    const m = DEFINES.exec(line);
    const name = m?.[1] ?? m?.[2] ?? m?.[3];
    if (!name || NOT_NAMES.has(name) || !names.has(name) || found.some((f) => f.name === name)) return;
    // Up to the closing line at the definition's own indent, for a block; one line otherwise.
    let end = n;
    if (/[{([]\s*$/.test(line)) {
      const close = new RegExp(`^\\s{${indent}}[}\\])]`);
      while (end < lines.length && end - n < MAX_DEFINITION_LINES - 1 && !close.test(lines[end]!)) end++;
      end = Math.min(end + 1, lines.length);
    }
    let start = n;
    while (start > 1 && n - start < 3 && /^\s*(\/\/|\*|\/\*\*)/.test(lines[start - 2]!)) start--;
    found.push({ name, start, end, at: names.get(name)! });
  });
  return found.sort((a, b) => a.at - b.at).map(({ name, start, end }) => ({ name, start, end }));
}
