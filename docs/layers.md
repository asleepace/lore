---
covers: [SPEC.md, README.md]
verified: 2026-10-16
---

# Layers

Why every capability above plain markdown is an opt-in layer, how the verification loop and gates work, and how the protocol is versioned.

L0 format → L1 markers → L2 CLI → L3 CI → L4 agent → L5 push. The table lives in `SPEC.md` §11.

## Invariants

### INV-1
No layer depends on a layer above it.

A repo can stop at any level and still get full value from the levels below.

### INV-2
Tool state never lives in the docs.

Indexes, hashes and caches go in `.lore/` or git notes. Frontmatter only holds fields a human can read and act on.

### INV-3
Tools ignore what they don't know: frontmatter fields, metadata keys, sections and `rel` values.

This is what lets a project add its own fields and a minor protocol version add features without breaking older tools (DEC-3).

## Decisions

### DEC-1
Agents propose doc updates; humans approve them in PR review.

Left alone, agents bloat prose, smooth over nuance and occasionally hallucinate. Normal PR review already exists, so it costs nothing extra.
Rejected: autonomous rewriting of docs.

### DEC-2
The agent step runs only when the deterministic step finds affected claims.

Most PRs touch nothing documented, so they cost $0 and finish fast.
Rejected: running the agent on every PR.

### DEC-3
Lore is versioned as a protocol: `LORE.md` declares `lore: <major>.<minor>`, minors only add from 1.0, and majors ship migration notes.

Repositories, CLIs, CI actions and agents all read the same files at different times and versions. A declared version lets each of them tell whether it understands a graph instead of guessing, and lets the format change without stranding old graphs.
Rejected: `spec: lore/0.1` as a label with no compatibility rules (v0.1). Rejected: no version at all, which turns every format change into a silent break for someone.

### DEC-4
The verification loop selects and records deterministically (L3) and asks and checks with a model (L4).

Selection is what keeps a model's cost proportional to what a change touches (DEC-2), and the record lives in git as trailers. So a repository with no model still gets the useful half (which claims a PR touches, and gates), and one with a model gets claims re-verified on every change. That is the second-order property v0.3 is built for: documentation that tests itself, with people seeing only the mismatches.
Rejected: a model in selection, which breaks [freshness#INV-1](freshness.md#inv-1) and makes every PR cost something. Rejected: no model step at all, which leaves upkeep to discipline, the cost that sank every wiki.

- depends: freshness#INV-1, freshness#DEC-5

### DEC-5
Every layer of a graph opens with a summary of the next, so L2 tools render digests at depths 0 to 3 by keeping first paragraphs.

The trial's lead paragraphs and claim sentences were already summaries; a digest just stops reading at a depth. That makes Lore a way for agents to load a repository by budget: the map to orient, claim sentences for the area being changed, the full text only for claims a change might break. It needs no summaries written for the purpose.
Rejected: generated summaries per node, which are a second text to keep in step. Rejected: digests as an L4 feature, which would make the cheapest context need a model.

### DEC-6
A change to code that upholds an invariant must update the claim, acknowledge it (`Lore-Ack:`) or be verified, under a `gate:` policy set in `LORE.md`.

This is what turns upkeep from discipline into a by-product of review: an invariant is visibly in the way of a PR that might break it, the way CODEOWNERS makes ownership visible. `warn` is the default so a repository can see the noise before it blocks anyone.
Rejected: blocking by default, which makes a new adopter's first week a wall of red. Rejected: no gates, which leaves staleness reports for someone to read later.

- depends: freshness#INV-1

## Quirks

### QRK-1
An L4 agent's own commit re-triggers L3 CI.

Without a guard, the agent loops on its own updates. L3 must skip runs authored by the bot.

## Plans

### PLAN-1
Build the L2 CLI in TypeScript first.

- review_after: 2027-01-15

### PLAN-2
L5: a `PreToolUse` hook that injects a node's summary and invariants when an agent opens a covered file.

- review_after: 2027-04-15
