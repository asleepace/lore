---
scope: domain
parent: lore
covers: [SPEC.md]
links:
  - { to: markers, rel: depends_on, note: "marker regions drive claim-level staleness" }
verified: 2026-10-16
review_after: 90d
---

# Freshness

Why Lore signals how much to trust each claim, and how staleness is detected without an LLM.

The primary reader is an agent, and agents trust text literally. A stale invariant is worse than no invariant, so telling the reader how far to trust each claim is the core feature, not an extra.

## Invariants

### INV-1
Detecting staleness never requires an LLM.

Detection runs on every PR. It must be deterministic, fast and free, so that the expensive agent step only runs when something is actually affected (see [layers#DEC-2](layers.md#dec-2)).

## Decisions

### DEC-1
Verification is recorded once per node (`verified`), not as commit hashes on each section.

Git already provides per-line history through `blame` and `log -L`.
Rejected: inline commit hashes per section, which add churn, noisy diffs and merge conflicts.

### DEC-2
Trust tier and freshness are separate axes.

The tier (tested, anchored, asserted) says how a claim is backed. Freshness says whether that backing changed since someone last checked. A tested claim can still be stale.
Rejected: a single combined trust score, which hides whether a claim is weakly backed or just unchecked.

### DEC-3
A node's verification commit is derived from `git blame` of its `verified:` line, not stored as a SHA.

A commit can't contain its own SHA, so a stored SHA always pointed one commit back, and every node was stale the moment it landed (QRK-1). Blame points at the right commit after the fact, and the file keeps a date a human can read.
Rejected: a stored `verified_at` SHA (v0). Rejected: having tools rewrite the SHA in a follow-up commit, which doubles commits and puts tool state in docs ([layers#INV-2](layers.md#inv-2)).

### DEC-4
`DEC` and `PLAN` claims have no trust tier.

They record history and intent, which nothing can enforce. In v0, counting them as "asserted" made this repo look 77% unbacked when all 8 invariants were anchored.
Rejected: a separate "historical" tier, which is a tier in name only.

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

- status: superseded
- superseded_by: freshness#DEC-3
