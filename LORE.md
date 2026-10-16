---
lore: 0.2
scope: app
summary: "Lore is a versioned markdown protocol, plus optional tooling, for an agent-maintained knowledge graph of a repo's rationale, invariants, edges and quirks."
nodes: [docs]
covers: [SPEC.md, README.md]
verified: 2026-10-16
review_after: 90d
---

# Lore

This repository defines Lore and documents itself with it. `SPEC.md` is the source of truth for the rules; these nodes hold the reasoning behind them.

## Map

- [format](docs/format.md): how nodes, claims and IDs are written, where nodes live, and what else a node may hold.
- [markers](docs/markers.md): how code (or any file) points at claims.
- [freshness](docs/freshness.md): trust tiers and staleness detection.
- [layers](docs/layers.md): progressive enhancement from plain markdown to agents, and how the protocol is versioned.

## Trials

- **GameRelay** (asleepace/gamerelay.io#225, 2026-10-16): 10 nodes, 68 claims, 26 markers on a
  monorepo with existing narrative docs. Most of v0.2 came from it; its findings are in that repo's
  `lore/_inbox.md` and in this repo's [inbox](docs/_inbox.md).

## Invariants

### INV-1
Deleting every Lore tool leaves the docs valid, useful markdown.

This is the test every feature must pass. Anything a tool needs to remember goes outside the docs (see [layers#INV-2](docs/layers.md#inv-2)).

## Decisions

### DEC-1
Lore documents only what code cannot express.

Docs that restate code rot first, because every code change makes them wrong. Rationale, invariants, cross-module behavior and accepted limits change far less often, and nothing else records them.
Rejected: auto-generated "what the code does" wikis, which are cheap to produce but answer the wrong question.

### DEC-2
One graph per repository.

Cross-repo links can't be verified atomically because each repo has its own history. Higher-level graphs can come later as federation.
Rejected: org-level graphs in v0.

## Limits

### LIM-1
References cannot point into another repository.

Follows from DEC-2.
