---
lore: 0.3
nodes: [docs]
covers: [SPEC.md, README.md]
verified: 2026-10-16
---

# Lore

Lore is a versioned markdown protocol for the knowledge code can't hold, kept honest by checks that run on every change.

This repository defines Lore and documents itself with it. `SPEC.md` is the source of truth for the rules; these nodes hold the reasoning behind them.

## Map

- [format](docs/format.md): how nodes, claims and IDs are written, where nodes live, and what else a node may hold.
- [markers](docs/markers.md): how code (or any file) points at claims.
- [freshness](docs/freshness.md): trust tiers, staleness and verification.
- [layers](docs/layers.md): progressive enhancement from plain markdown to agents, the verification loop, and how the protocol is versioned.
  - [cli](docs/cli.md): `lore`, small composable commands for each step of the loop.

## Goals

The spec is judged against these (`SPEC.md` §1, and DEC-5):

- **Zoom**: the graph reads at any depth, because every layer opens with a summary of the next.
- **Action semantics**: a claim's kind tells an agent what to do: a guardrail, a prior or context.
- **Gates**: a change to code that upholds an invariant can't land silently.
- **History**: anything that mentions a claim joins its history; nothing is declared.
- **Self-evaluation**: every claim is a question with a known answer.
- **Contract**: a package's public claims ship with it.
- **Blast radius**: claims say what they rest on.

Together they make the **verification loop**: a change selects the claims it might break, each is
checked against the new code, and people see only the mismatches. Two effects follow: the score at
each depth says how much context an agent needs, and claims that keep being acknowledged mark where
the code fights its own design. The [cli](docs/cli.md) is the loop as small commands an agent or a
CI job can call one at a time, which is how the graph keeps itself current.

## Trials

- **GameRelay** (asleepace/gamerelay.io#225, 2026-10-16): 10 nodes, 68 claims, 26 markers on a
  monorepo with existing narrative docs. Most of v0.2 and v0.3 came from it; its findings are in
  that repo's `lore/_inbox.md` and in this repo's [inbox](docs/_inbox.md).

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

### DEC-3
A node folder can be declared public: its claims are a package's contract, readable on their own and shipped with it.

The GameRelay trial put markers in an SDK that is mirrored to a public repository, pointing at nodes its readers can't open. A public folder ships with the package, can't reference private nodes, and makes weakening a guarantee visible as a breaking change.
Rejected: stripping markers on export, which hides the problem instead of giving the package its own claims. Rejected: cross-repo references (DEC-2).

### DEC-4
The core stays closed: three claim kinds and no declared extensions, until two trials ask for the same one.

v0.3 compared a minimal closed format with a core plus declared profiles. The closed one keeps every graph readable by every agent and tool without learning a dialect; the profile version's two pieces the goals needed (`depends:`, public folders) were taken on their own.
Rejected: profiles and declared claim types now, which buy flexibility no trial has asked for at the cost of dialects.

### DEC-5
The spec states its goals and the verification loop before any rule, and every feature is judged against them.

v0.1 and v0.2 grew by adding what each trial asked for, which is how specs bloat. v0.3 started from the properties the format should give for free and kept only what serves them; the rest went (scope, links, plans as claims). Stating the goals first makes the next "should we add X?" answerable.
Rejected: a feature list without goals, which can only grow.

## Limits

### LIM-1
References cannot point into another repository.

Follows from DEC-2.
