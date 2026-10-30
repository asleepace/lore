---
scope: domain
parent: app
summary: Why claims should be checked by tools and asserted by the code that upholds them, so docs and code fail loudly together.
covers: [cli/**, package.json]
links:
  - { to: freshness, rel: depends_on, note: "checks report trust tiers" }
  - { to: layers, rel: related, note: "lore check is the first L2 tool" }
verified: 2026-10-30
review_after: 90d
---

# Contracts

These ideas came out of designing [Nexus](https://github.com/asleepace/nexus/pull/1), where every invariant names how it is enforced and a quick script checking that every invariant ID resolved found real mistakes in seconds. Its [CONTRACTS](https://github.com/asleepace/nexus/blob/docs/nexus-v0-design/docs/CONTRACTS.md) doc applies the same idea to code: functions state laws, and generated inputs turn those laws into tests. The NASA/JPL "Power of 10" rules (especially rule 5, assertion density with explicit recovery) are the inspiration.

Lore's version: docs should be able to test themselves, and code that upholds a claim should be able to assert it.

## Invariants

### INV-1
`lore check` is deterministic and needs no network, LLM or git history.

It runs the same way on a laptop, in CI and on a tarball. Git is used only to list tracked files when available.

### INV-2
Every finding names its rule code, file and line.

A finding a reader can't locate gets ignored, and ignored lint is worse than none.

## Decisions

### DEC-1
Lore ships `lore check` before staleness detection.

Lint (SPEC.md §10) catches broken references and malformed nodes today, on any repo, without diffs or history. It also reports trust tiers, which is the cheapest form of docs testing themselves. Fulfills the first step of [layers#PLAN-1](layers.md#plan-1).
Rejected: building L3 diff-based staleness first, which needs git plumbing before it helps anyone.

### DEC-2
The CLI implements the spec as written; new rules start as plans here.

A tool that enforces rules the spec doesn't state turns the tool into the spec, breaking [layers#INV-1](layers.md#inv-1) in spirit.
Rejected: shipping experimental rules behind flags in v0.

### DEC-3
Runtime assertions in code carry a full claim reference.

A failing check like `check(ok, 'auth#INV-1')` names the claim it protects, so a crash, a log line, a test failure and the doc all share one key. Until PLAN-1 lands, pair it with an `enforces` marker.
Rejected: free-text assertion messages, which can't be joined back to the docs.

### DEC-4
The CLI uses Bun with no dependencies.

Lore's tooling should be as easy to delete as it is to adopt ([app#INV-1](../APP.md#inv-1)). Bun parses YAML and runs tests itself.
Rejected: a Node CLI with a YAML library and a test framework.

## Limits

### LIM-1
`lore check` only detects date-based staleness (`L008`), not diff-based staleness (SPEC.md §8).

### LIM-2
Bare node IDs in prose aren't checked.

A word like `format` can't be told apart from a reference to the `format` node without markup.

## Plans

### PLAN-1
Add a `checks` marker verb for runtime assertions, and a `checked` trust tier between anchored and tested.

A runtime check fails loudly when its claim breaks, which is stronger than an anchor but weaker than a test, because it only fires on code that runs.

- review_after: 2027-01-30

### PLAN-2
Let a claim that states a value link a check that compares it with the code.

Example: a doc says retries are capped at three; `lore check` reads the constant in code and flags a mismatch. Docs that test their own facts.

- review_after: 2027-01-30

### PLAN-3
Show live claim status from runtime assertion reports, keyed by claim ID.

A violation reported as `auth#INV-1` can turn that claim red in an editor, a dashboard or the rendered doc.

- review_after: 2027-04-30

### PLAN-4
Treat functions with declared laws plus generated inputs as the `tested` tier.

Laws like round-trips and bounds, run against inputs generated from the function's types, are tests nobody had to write.

- review_after: 2027-04-30
