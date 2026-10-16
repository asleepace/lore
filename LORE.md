---
lore: 0.4
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

## Purpose

What the spec is judged against (`SPEC.md` §1, DEC-6). Lore is for three moments in an agent's work:

- **Plan**: what constraints does the area I'm changing have, and how does it fit the system?
- **Review**: what could this change break, and does it?
- **Context**: what here isn't visible in the code?

Four intentions serve them, ranked so the higher wins a conflict: **stay true**, **protect what must
not break**, **capture what code can't say**, and **the right context at the right cost**. All four
are bounded by one constraint: Lore must cost almost nothing to keep, so the core asks authors for
claims and markers and derives everything else (DEC-9). The [cli](docs/cli.md) is these uses as
small commands: `digest`, `show` and `trace` for planning, `review` for reviewing.

## Trials

- **GameRelay** (asleepace/gamerelay.io#225, 2026-10-16): 10 nodes, 68 claims, 26 markers on a
  monorepo with existing narrative docs. Most of v0.2 and v0.3 came from it; its findings are in
  that repo's `lore/_inbox.md` and in this repo's [inbox](docs/_inbox.md). Its 45-case benchmark
  shaped v0.4 ([cli#NOTE-5](docs/cli.md#note-5)).

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

> **agent (Claude), 2026-10-16:** Still active, as an extension (DEC-8): no trial has published a package with a public folder yet.

### DEC-4
The core stays closed: three claim kinds and no declared extensions, until two trials ask for the same one.

v0.3 compared a minimal closed format with a core plus declared profiles. The closed one keeps every graph readable by every agent and tool without learning a dialect; the profile version's two pieces the goals needed (`depends:`, public folders) were taken on their own.
Rejected: profiles and declared claim types now, which buy flexibility no trial has asked for at the cost of dialects.

### DEC-5
The spec states its goals and the verification loop before any rule, and every feature is judged against them.

v0.1 and v0.2 grew by adding what each trial asked for, which is how specs bloat. v0.3 started from the properties the format should give for free and kept only what serves them; the rest went (scope, links, plans as claims). Stating the goals first makes the next "should we add X?" answerable.
Rejected: a feature list without goals, which can only grow.

- superseded_by: lore#DEC-6

### DEC-6
Lore's purpose is three uses (plan, review, context), served by four ranked intentions and bounded by one constraint: it must cost almost nothing to keep.

v0.3's seven goals mixed reasons with mechanisms, and nothing said which won a conflict. Reviewed against what the trials used, zoom, gates, action semantics, blast radius and self-evaluation turned out to be ways of serving three uses; history and contract served none. Ranking settles conflicts: truth outranks cost, so a review checks every invariant when it can afford to ([layers#DEC-7](docs/layers.md#dec-7)), and a digest may drop detail but never shows an unverified claim as verified. Keeping the docs true is a prerequisite, not the product: the product is an agent planning or reviewing with knowledge it couldn't easily get from the code.
Rejected: keeping seven flat goals, which can't settle "should we add X?". Rejected: "documentation that tests itself" as the purpose, which optimizes the upkeep loop over what people read.

- depends: lore#DEC-1

### DEC-7
A claim's history is derived from git through its stable ID; Lore builds nothing for it.

Git already holds every change. Because IDs never move (format#INV-1), `git log --grep` and `-G` find every commit that mentions or touches a claim, and `Lore-Verified:` and `Lore-Ack:` trailers make verification searchable. That makes history a consequence of two principles, not a goal; `lore history` is a thin convenience. PR discussions and issues live outside git, and only matter once someone needs them.
Rejected: history as a goal, with PR and issue indexing built in ahead of need.

### DEC-8
Features no trial has used are extensions outside the core, free to change until a trial uses them: public folders and push hooks.

Both answer real needs (DEC-3; agents getting constraints when they open a file), but every rule in the core is something each tool and reader has to learn. An extension says "this is the intended shape" without making it part of conformance. L5 left the conformance table for the same reason.
Rejected: deleting them, which loses the design. Rejected: keeping them core, which charges every reader for features nobody has exercised.

### DEC-9
Tools derive what they can: authors write claims and markers, and anything declared besides them is an optional hint.

On GameRelay nothing declared a `depends:`, 43 of 68 claims had no edge to another claim, and nobody triaged the inbox. Everything that worked was derived: markers, the same-file definitions a marked region uses (selection reached 14, then 17, of 27 deliberate breaks), references in prose, and git history. A feature that needs authors to keep a second structure in step with the code will be skipped, then wrong.
Rejected: requiring `depends:` for blast radius, which nobody writes. Rejected: dropping `depends:`, which costs nothing to keep as a hint where an author knows a link the text doesn't show.

- depends: lore#DEC-6

## Limits

### LIM-1
References cannot point into another repository.

Follows from DEC-2.
