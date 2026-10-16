import type { Issue, Marker } from './types';
import { normalizeRef, PREFIXES, stripCode } from './util';

/** A full reference, or a local one (an error, L006); bare words never count, so prose about markers stays prose. */
const REF = `(?:[A-Za-z][A-Za-z0-9-]*#[A-Za-z]+-\\d+|(?:${PREFIXES.join('|')})-\\d+)`;
/** `@lore <ref>, <ref>` · `@lore see <ref>` · v0.2's `@lore enforces|implements <ref>`. */
const MARKER = new RegExp(`@lore\\s+(?:([a-z]+)\\s+)?(${REF}(?:\\s*,\\s*${REF})*)`, 'g');
const VERBS: Record<string, Marker['verb']> = { see: 'see', enforces: 'upholds', implements: 'upholds' };
const MAX_REGION = 50;

/**
 * Markers in one file, with the region each anchors: from its line to the next blank line or the
 * next marker, at most 50 lines (SPEC.md §5.1). In markdown only markers inside HTML comments count,
 * and never in fenced or inline code.
 */
export function scanMarkers(file: string, text: string, issues: Issue[]): Marker[] {
  const isMd = file.endsWith('.md');
  const source = isMd ? stripCode(text) : text;
  const lines = source.split('\n');
  const found: { line: number; verb: Marker['verb']; refs: string[] }[] = [];
  lines.forEach((raw, i) => {
    if (!raw.includes('@lore')) return;
    if (isMd && !/<!--[\s\S]*@lore/.test(raw)) return;
    for (const m of raw.matchAll(MARKER)) {
      const word = m[1];
      let refs = m[2]!.split(',').map((r) => r.trim());
      let verb: Marker['verb'] = 'upholds';
      if (word) {
        if (!(word in VERBS)) {
          issues.push({ code: 'L006', level: 'error', where: `${file}:${i + 1}`, message: `unknown marker verb "${word}"` });
          continue;
        }
        verb = VERBS[word]!;
      }
      const bad = refs.filter((r) => !r.includes('#'));
      for (const r of bad) {
        issues.push({ code: 'L006', level: 'error', where: `${file}:${i + 1}`, message: `marker reference "${r}" isn't full (node#PREFIX-n)` });
      }
      refs = refs.filter((r) => r.includes('#')).map(normalizeRef);
      if (refs.length) found.push({ line: i + 1, verb, refs });
    }
  });
  const markerLines = new Set(found.map((f) => f.line));
  const out: Marker[] = [];
  for (const f of found) {
    let end = f.line;
    while (end < lines.length && end - f.line < MAX_REGION && lines[end]!.trim() !== '' && !markerLines.has(end + 1)) end++;
    for (const ref of f.refs) out.push({ file, line: f.line, endLine: end, ref, verb: f.verb });
  }
  return out;
}
