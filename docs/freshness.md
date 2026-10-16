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

### DEC-9
A change to a same-file definition that a marker region uses, such as a constant or a helper, reaches the claim at the region's severity.

`check` shows those definitions in the prompt too. `lore bench` on GameRelay found selection reaching 14 of 27 deliberately broken claims, all of them breaks inside a marked region; the definition of a constant or helper the region relies on was the commonest blind spot. Following same-file definitions raised it to 17 without a marker more, deterministically. It is a heuristic for JavaScript-like code, which is why the spec makes it a MAY.
Rejected: following callers of the marked code, which reaches every claim in a large file. Rejected: definitions across files, which needs a language server, and so a dependency.

- depends: freshness#NOTE-2

### DEC-10
How far to trust reviews is measured per repository with a benchmark: selection recall and noise, false confirmations, false alarms and inferability.

A check can agree with a broken claim (NOTE-1), so trust has to be a number. The first benchmark showed why each measure is separate: selection was the weak stage (17 of 27), the prompt was the fix for false confirmations (3 in 47, then 0 in 53), and false alarms pointed at claim wording, not code. Recall alone would reward selecting everything, so noise is reported too. Inferability, a claim an agent answers from the code alone, catches claims that restate the code.
Rejected: trusting checks because they look right on a few examples, which is where v0.3 stood after 17 checks.

- depends: freshness#NOTE-1, cli#DEC-10

### DEC-11
Decisions are checked only after a benchmark shows the decision question finds drift without noise.

Decisions are the largest kind (45 of 75 claims in this repository) and the loop doesn't check them, so the strongest result covers the smallest part of the graph. A decision can be asked about: "does the code still do what this decided, rather than what it rejected?" But a decision is a choice, not a guarantee, and a check that flags every refactor near one would teach people to ignore reviews.
Rejected: checking decisions now, unmeasured. Rejected: never checking them, which leaves most of the graph to rot unseen.

- depends: freshness#DEC-10

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

The verification loop's value depends on how often this happens. `lore bench` measures it: on GameRelay, 3 false confirmations in 47 checks with the first prompt and 0 in 53 with the current one ([cli#NOTE-5](cli.md#note-5)), on breaks the checking model also wrote. Keeping "tested" for real tests means a false confirmation can make a claim look fresh, never better enforced than it is.

- depends: freshness#DEC-5

### NOTE-2
Selection sees marker regions and the same-file definitions they use, so a change in a caller or another file reaches nothing; reviews check every invariant to cover it.

DEC-9 added the definitions; [layers#DEC-7](layers.md#dec-7) makes checking every invariant the default when the graph is small.

In the GameRelay trial, removing `'__proto__'` from `UNSAFE_KEYS`, defined about 500 lines above the marked check, selected no claim, while a check with Claude, asked directly, found the break. Marking the definition fixed that case; the sweep (`lore check --sweep`) is for the cases nobody marked.

- depends: freshness#INV-1
