---
scope: domain
parent: lore
summary: "Why every capability above plain markdown is an opt-in layer, the rules agents follow, and how the protocol is versioned."
covers: [SPEC.md, README.md]
links:
  - { to: freshness, rel: depends_on, note: "L3/L4 run the staleness rules" }
verified: 2026-10-16
review_after: 90d
---

# Layers

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
