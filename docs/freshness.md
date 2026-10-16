---
covers: [SPEC.md]
verified: 2026-10-16
---

# Freshness

Why Lore signals how much to trust each claim, how staleness is detected without an LLM, and how claims are verified.

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

- status: superseded
- superseded_by: freshness#DEC-8

### DEC-5
A claim is verified by a `Lore-Verified: ref` commit trailer or PR line, and its freshness counts from its latest verification or its node's `verified` date, whichever is later.

This answers the open question of per-claim or per-node verification: per node by hand, per claim by evidence. The evidence lives in git, so the docs carry no tool state ([layers#INV-2](layers.md#inv-2)), and the verification loop can refresh dozens of claims without editing a file.
Rejected: a `verified:` key per claim, which makes every check a docs edit. Rejected: per-node only (v0.2), which re-checks a whole node for one claim.

### DEC-6
A claim may list `files:` that uphold it when those files can't carry a marker, and that anchors it.

In the trial, invariants about absence ("the SDK has no runtime dependencies") were enforced by JSON files, which can't hold a comment, so they stayed "asserted" forever. This is the one exception to [markers#DEC-1](markers.md#dec-1): claims point at files only where files can't point back.
Rejected: allowing comments in JSON through a sidecar file, which is a second file to keep in sync.

### DEC-7
A claim may list what it `depends:` on; a high-severity change to one flags the claims that depend on it, one hop only.

This is the blast radius of a change, measured on intent rather than code. One hop keeps it from flooding a PR with every claim downstream; a reviewer who wants more can follow the chain.
Rejected: transitive propagation, which turns one change into a list nobody reads. Rejected: node-level links (v0.2), too coarse to say which guarantee rests on which.

### DEC-8
Only invariants have a trust tier.

Decisions, notes and plans record choices and context, which nothing can enforce; the trial's "asserted" list was mostly limits and quirks that never could be anchored, which made a healthy graph look unbacked. A tier is a question about enforcement, so only claims that can be enforced get one.
Rejected: tiers for `NOTE` claims, which repeats DEC-4's problem one kind over.

## Edges

### EDGE-1
Removing a marker makes its claim stale at high severity, even if no other code changed.

The claim has silently lost its anchor and dropped a trust tier. That needs a human or agent decision, not a quiet downgrade. See [markers#DEC-1](markers.md#dec-1).

## Limits

### LIM-1
A node with no `covers` and no markers can only go stale by date.

Its claims' `review_after` dates are its only freshness signal (v0.3 dropped node-level `review_after`). Every node in this repo is close to that today, since there is no code yet and `covers: [SPEC.md]` is coarse.

## Quirks

### QRK-1
`verified_at` cannot name the commit that sets it.

A commit can't contain its own SHA. Verifying a node in the same commit that edits it can only record the parent commit, which looks one commit stale.

- status: superseded
- superseded_by: freshness#DEC-3

## Notes

### NOTE-1
An agent's check can agree with a claim that is no longer true, so a check refreshes freshness but never raises a tier.

The verification loop's value depends on how often this happens, which nobody has measured yet. Keeping "tested" for real tests means a false confirmation can make a claim look fresh, never better enforced than it is.

- depends: freshness#DEC-5
