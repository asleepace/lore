import type { Claim, ClaimRecord, Graph } from './types';
import { normalizeRef } from './util';

/**
 * The question a claim poses (SPEC.md §8 step 2): its `ask:` if it has one, otherwise a template
 * built from its statement. The template is deterministic on purpose; an agent may rephrase it, but
 * the claim and the expected answer ("yes, still true") are fixed.
 */
// @lore cli#DEC-5
export function questionFor(c: Claim): string {
  if (c.meta.ask) return c.meta.ask;
  const s = c.statement.replace(/\s+/g, ' ').trim().replace(/[.;:]$/, '');
  switch (c.kind) {
    case 'INV':
      return `Does this still always hold in the code: "${s}"? Answer yes or no, and cite the code that makes it true or breaks it.`;
    case 'DEC':
      return `Does the code still follow this decision: "${s}"? Answer yes or no, and name any rejected alternative it now uses.`;
    default:
      return `Is this still accurate: "${s}"? Answer yes or no, and cite the code.`;
  }
}

export function ask(graph: Graph, records: { ref: string }[]): ClaimRecord[] {
  return records.flatMap((r) => {
    const c = graph.claims.get(normalizeRef(r.ref));
    if (!c) return [];
    return [{ ...(r as ClaimRecord), ref: c.ref, kind: c.kind, statement: c.statement, question: questionFor(c) }];
  });
}
