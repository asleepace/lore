/**
 * The frontmatter subset of SPEC.md §3.1, parsed without a YAML library so errors can say exactly
 * what's wrong: one `key: value` per line; scalars bare or double-quoted; flow lists `[a, b]`.
 * Block lists under a key (v0.2's `links:`) are accepted and kept raw, so old graphs still read.
 */
// @lore format#DEC-11, cli#DEC-3

export interface FrontmatterResult {
  data: Record<string, unknown>;
  /** `L015`: not valid YAML. `L019`: valid YAML, outside the subset. */
  problems: { code: 'L015' | 'L019'; line: number; message: string }[];
  /** Lines the frontmatter block takes in the file, fences included (0 when there is none). */
  lines: number;
}

const KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/;

export function splitFrontmatter(text: string): { block: string | null; body: string; lines: number } {
  if (!text.startsWith('---\n')) return { block: null, body: text, lines: 0 };
  const end = text.indexOf('\n---\n', 3);
  const endAtEof = text.endsWith('\n---') ? text.length - 4 : -1;
  const at = end >= 0 ? end : endAtEof;
  if (at < 0) return { block: null, body: text, lines: 0 };
  const block = text.slice(4, at);
  const body = text.slice(at + 5);
  return { block, body, lines: block.split('\n').length + 2 };
}

function unquote(raw: string, line: number, problems: FrontmatterResult['problems']): string {
  if (!raw.startsWith('"')) return raw;
  if (raw.length < 2 || !raw.endsWith('"') || raw.endsWith('\\"')) {
    problems.push({ code: 'L015', line, message: 'unterminated double-quoted string' });
    return raw.slice(1);
  }
  return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function scalar(raw: string, line: number, problems: FrontmatterResult['problems']): unknown {
  const v = raw.trim();
  if (v.startsWith('"')) return unquote(v, line, problems);
  if (v.startsWith("'")) {
    problems.push({ code: 'L019', line, message: 'single-quoted strings are outside the subset; use double quotes' });
    return v.replace(/^'|'$/g, '');
  }
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) {
      problems.push({ code: 'L015', line, message: 'flow list is missing its closing ]' });
      return [];
    }
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitList(inner).map((item) => scalar(item, line, problems));
  }
  if (v.startsWith('{')) {
    problems.push({ code: 'L019', line, message: 'flow maps are outside the subset (except in v0.2 `links`)' });
    return v;
  }
  if (v === '|' || v === '>' || v.startsWith('&') || v.startsWith('*') || v.startsWith('!')) {
    problems.push({ code: 'L019', line, message: `'${v[0]}' (block scalars, anchors, tags) is outside the subset` });
    return v;
  }
  // A colon followed by a space inside a plain scalar is a YAML error: the classic summary trap.
  if (/:\s/.test(v)) {
    problems.push({ code: 'L015', line, message: 'a plain value can\'t contain ": "; wrap it in double quotes, or move prose into the body' });
    return v;
  }
  // Integers only: `lore: 0.10` is a version, and Number() would read it as 0.1.
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v;
}

/** Split `a, "b, c", d` on top-level commas. */
function splitList(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === '"' && inner[i - 1] !== '\\') quoted = !quoted;
    if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseFrontmatter(text: string): FrontmatterResult {
  const { block, lines } = splitFrontmatter(text);
  const data: Record<string, unknown> = {};
  const problems: FrontmatterResult['problems'] = [];
  if (block === null) return { data, problems, lines: 0 };
  const rows = block.split('\n');
  let blockKey: string | null = null;
  rows.forEach((row, i) => {
    const line = i + 2; // the opening fence is line 1
    if (!row.trim() || row.trimStart().startsWith('#')) return;
    if (/^\s/.test(row)) {
      if (blockKey && /^\s+- /.test(row)) {
        (data[blockKey] as string[]).push(row.trim().slice(2));
        return;
      }
      problems.push({ code: blockKey ? 'L019' : 'L015', line, message: 'indented line outside a list' });
      return;
    }
    const m = KEY.exec(row);
    if (!m) {
      problems.push({ code: 'L015', line, message: `expected "key: value", got "${row.slice(0, 40)}"` });
      blockKey = null;
      return;
    }
    const [, key, value] = m;
    if (key! in data) problems.push({ code: 'L015', line, message: `duplicate key "${key}"` });
    if (value === undefined || value.trim() === '') {
      data[key!] = [];
      blockKey = key!;
      return;
    }
    blockKey = null;
    data[key!] = scalar(value, line, problems);
  });
  return { data, problems, lines };
}
