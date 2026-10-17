import type { Claim, Graph, Tier } from './types';
import { normalizeRef } from './util';

/**
 * Trust tier of an invariant (SPEC.md §5.2): tested (a `tests:` entry or a marker in a test file),
 * anchored (a marker or a `files:` entry), asserted (prose only). Other kinds have no tier.
 */
// @lore freshness#DEC-8, freshness#DEC-6
export function tierOf(graph: Graph, c: Claim): Tier | null {
  if (c.kind !== 'INV') return null;
  const ref = normalizeRef(c.ref);
  const marks = graph.markers.filter((m) => m.ref === ref && m.verb === 'upholds');
  if (c.meta.tests || marks.some((m) => /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/.test(m.file))) return 'tested';
  if (marks.length || c.meta.files) return 'anchored';
  return 'asserted';
}
