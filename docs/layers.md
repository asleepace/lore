---
covers: [SPEC.md, README.md]
verified: 2026-10-16
---

# Layers

Why every capability above plain markdown is an opt-in layer, how the verification loop and gates work, and how the protocol is versioned.

L0 format → L1 markers → L2 CLI → L3 CI → L4 agent. The table lives in `SPEC.md` §12.

## Invariants

### INV-1
No layer depends on a layer above it.

A repo can stop at any level and still get full value from the levels below.

### INV-2
Tool state never lives in the docs.

Indexes, hashes and caches go in `.lore/` or git notes. Frontmatter only holds fields a human can read and act on.

### INV-3
Tools ignore what they don't know: frontmatter fields, metadata keys, sections and claim prefixes.

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

- superseded_by: layers#DEC-7

### DEC-3
Lore is versioned as a protocol: `LORE.md` declares `lore: <major>.<minor>`, minors only add from 1.0, and majors ship migration notes.

Repositories, CLIs, CI actions and agents all read the same files at different times and versions. A declared version lets each of them tell whether it understands a graph instead of guessing, and lets the format change without stranding old graphs.
Rejected: `spec: lore/0.1` as a label with no compatibility rules (v0.1). Rejected: no version at all, which turns every format change into a silent break for someone.

### DEC-4
The verification loop selects, asks and records deterministically (L3); only the check uses a model (L4).

Asking is deterministic too, since [cli#DEC-5](cli.md#dec-5) found a question has to be fixed for two runs of the loop to mean the same thing. Selection is what keeps a model's cost proportional to what a change touches (DEC-2), and the record lives in git as trailers. So a repository with no model still gets the useful half (which claims a PR touches, and gates), and one with a model gets claims re-verified on every change. That is the second-order property v0.3 is built for: documentation that tests itself, with people seeing only the mismatches.
Rejected: a model in selection, which breaks [freshness#INV-1](freshness.md#inv-1) and makes every PR cost something. Rejected: no model step at all, which leaves upkeep to discipline, the cost that sank every wiki.

- depends: freshness#INV-1, freshness#DEC-5

### DEC-5
Every layer of a graph opens with a summary of the next, so L2 tools render digests at depths 0 to 3 by keeping first paragraphs.

The trial's lead paragraphs and claim sentences were already summaries; a digest just stops reading at a depth. That makes Lore a way for agents to load a repository by budget: the map to orient, claim sentences for the area being changed, the full text only for claims a change might break. It needs no summaries written for the purpose.
Rejected: generated summaries per node, which are a second text to keep in step. Rejected: digests as an L4 feature, which would make the cheapest context need a model.

### DEC-6
A change to code that upholds an invariant must update the claim, acknowledge it (`Lore-Ack:`) or be verified, under a `gate:` policy set in `LORE.md`.

This is what turns upkeep from discipline into a by-product of review: an invariant is visibly in the way of a PR that might break it, the way CODEOWNERS makes ownership visible. `warn` is the default so a repository can see the noise before it blocks anyone.
Rejected: blocking by default, which makes a new adopter's first week a wall of red. Rejected: no gates, which leaves staleness reports for someone to read later. Rejected: reading the policy from the pull request's own `LORE.md`, which lets a change set `gate: off` for itself; the Action reads it from the base branch.

- depends: freshness#INV-1

### DEC-7
A review checks every active invariant when there are few enough to afford it, ordered by selection; above that, it checks what selection reaches and a sweep covers the rest.

DEC-2 assumed selection was what made checking cheap and correct. The GameRelay benchmark split the two: selection reached 17 of 27 deliberate breaks, while checking each invariant caught all 27, and 45 checks took about two minutes six at a time. Protecting invariants outranks the cost of context ([lore#DEC-6](../LORE.md#dec-6)), so at tens of invariants the review checks them all; selection still decides the order, and what is checked when there are hundreds.
Rejected: checking only selected claims at any size (DEC-2), which misses breaks in callers and other files. Rejected: always checking everything, which stops scaling past a few hundred invariants.

- depends: freshness#NOTE-2, freshness#DEC-10

## Quirks

### QRK-1
An L4 agent's own commit re-triggers L3 CI.

Without a guard, the agent loops on its own updates. L3 must skip runs authored by the bot.

## Plans

### PLAN-1
Build the L2 CLI in TypeScript first.

- review_after: 2027-01-15
- status: retired

> **agent (Claude), 2026-10-16:** Done: the CLI is TypeScript (`cli/`). Plans aren't claims any more (`SPEC.md` §4.1); this stays as a tombstone so its number isn't reused.

### PLAN-2
L5: a `PreToolUse` hook that injects a node's summary and invariants when an agent opens a covered file.

- review_after: 2027-04-15
- status: retired

> **agent (Claude), 2026-10-16:** Retired as a level: push is an extension (`SPEC.md` §13.2, [lore#DEC-8](../LORE.md#dec-8)). The hook is still worth building once `show` and `trace` have been used by agents for a while.
