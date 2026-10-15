---
scope: domain
parent: app
summary: Why every capability above plain markdown is an opt-in layer, and the rules agents follow.
covers: [SPEC.md, README.md]
links:
  - { to: freshness, rel: depends_on, note: "L3/L4 run the staleness rules" }
verified: 2026-10-15
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

## Decisions

### DEC-1
Agents propose doc updates; humans approve them in PR review.

Left alone, agents bloat prose, smooth over nuance and occasionally hallucinate. Normal PR review already exists, so it costs nothing extra.
Rejected: autonomous rewriting of docs.

### DEC-2
The agent step runs only when the deterministic step finds affected claims.

Most PRs touch nothing documented, so they cost $0 and finish fast.
Rejected: running the agent on every PR.

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
