---
scope: domain
parent: app
summary: Why Lore signals how much to trust each claim, and how staleness is detected without an LLM.
covers: [SPEC.md]
links:
  - { to: markers, rel: depends_on, note: "marker regions drive claim-level staleness" }
verified_at: 95d185d
review_after: 90d
---

# Freshness

The primary reader is an agent, and agents trust text literally. A stale invariant is worse than no invariant, so telling the reader how far to trust each claim is the core feature, not an extra.

## Invariants

### INV-1
Detecting staleness never requires an LLM.

Detection runs on every PR. It must be deterministic, fast and free, so that the expensive agent step only runs when something is actually affected (see [layers#DEC-2](layers.md#dec-2)).

## Decisions

### DEC-1
Verification is recorded once per node (`verified_at`), not as commit hashes on each section.

Git already provides per-line history through `blame` and `log -L`.
Rejected: inline commit hashes per section, which add churn, noisy diffs and merge conflicts.

- date: 2026-10-15

### DEC-2
Trust tier and freshness are separate axes.

The tier (tested, anchored, asserted) says how a claim is backed. Freshness says whether that backing changed since someone last checked. A tested claim can still be stale.

- date: 2026-10-15

## Edges

### EDGE-1
Removing a marker makes its claim stale at high severity, even if no other code changed.

The claim has silently lost its anchor and dropped a trust tier. That needs a human or agent decision, not a quiet downgrade. See [markers#DEC-1](markers.md#dec-1).

## Limits

### LIM-1
A node with no `covers` and no markers can only go stale by date.

`review_after` is its only freshness signal. Every node in this repo is close to that today, since there is no code yet and `covers: [SPEC.md]` is coarse.

## Quirks

### QRK-1
`verified_at` cannot name the commit that sets it.

A commit can't contain its own SHA. Verifying a node in the same commit that edits it can only record the parent commit, which looks one commit stale.
