import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Claim, Graph, Tier } from './types';
import { normalizeRef } from './util';

/** The comma-separated paths in a `tests:` or `files:` value. */
export function pathsIn(value?: string): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** The paths in a `tests:` or `files:` value that exist in the repository. A missing path backs nothing. */
// @lore freshness#INV-2
export function existingPaths(graph: Graph, value?: string): string[] {
  return pathsIn(value).filter((p) => existsSync(join(graph.root, p)));
}

/**
 * Trust tier of an invariant (SPEC.md §5.2): tested (a `tests:` path that exists, or a marker in a
 * test file), anchored (a marker, or a `files:` path that exists), asserted (prose only). Other kinds
 * have no tier.
 */
// @lore freshness#DEC-8, freshness#DEC-6, freshness#INV-2
export function tierOf(graph: Graph, c: Claim): Tier | null {
  if (c.kind !== 'INV') return null;
  const ref = normalizeRef(c.ref);
  const marks = graph.markers.filter((m) => m.ref === ref && m.verb === 'upholds');
  if (existingPaths(graph, c.meta.tests).length || marks.some((m) => /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/.test(m.file))) return 'tested';
  if (marks.length || existingPaths(graph, c.meta.files).length) return 'anchored';
  return 'asserted';
}
