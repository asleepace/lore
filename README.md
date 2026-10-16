# Lore

> **L**inked **O**bservations, **R**ationale & **E**dges

A protocol for the knowledge code can't hold: why it is the way it is, what must stay true, and what was tried and rejected. Plain markdown in the repository, read mostly by agents, and checked against the code on every change.

## What it's for

- **Planning:** an agent about to change something looks up the constraints in that area, and how it fits the rest of the system, before writing code.
- **Reviewing:** an agent reviewing a change sees which guarantees it puts at stake, what rests on them, and whether each still holds.
- **Context:** what it reads is only what the code doesn't already say, cheap to query and traverse.

Four intentions serve these, ranked so the higher wins a conflict: stay true, protect what must not
break, capture what code can't say, give the right context at the right cost. All four are bounded
by one constraint: it must cost almost nothing to keep.

## Core ideas

- **Claims, not pages.** Knowledge is a set of short statements with stable IDs, in three kinds that tell an agent how to act:
  - `INV` invariant, a **guardrail**: don't break it.
  - `DEC` decision, a **prior**: don't re-propose what its `Rejected:` line ruled out.
  - `NOTE` note, **context**: known behavior, limits, quirks.
- **IDs are links.** `room#INV-2` resolves to `docs/room.md#inv-2`, on GitHub and in editors, with no tooling.
- **Code points at claims.** A comment says which code upholds what:
  ```ts
  // @lore room#INV-2
  ```
- **Derive, don't declare.** Authors write claims and markers. Edges, staleness and history are derived from them, from references in prose, and from git.
- **Zoom.** Every layer opens with a summary of the next, so a graph renders at any depth: a few hundred words to orient a whole repository, full text only for what a change might break.
- **Reviews check the code.** A change selects the claims it reaches; an agent checks every invariant (all of them, when there are few enough) against the new code; only mismatches reach a person.
- **Trust is measured.** A benchmark breaks claims on purpose and counts how often checks miss.

## Tools

[`cli/`](cli/) is `lore`: `digest`, `show`, `trace` and `find` for planning; `review` for reviewing
a change; the loop's steps on their own (`select`, `ask`, `check`, `gate`, `record`, `history`,
`lint`); and `bench` for measuring trust. The same are MCP tools for agents (`lore mcp`), and a
GitHub Action ([`action.yml`](action.yml)) runs on pull requests.

## Progressive enhancement

Every layer is opt-in. If all tooling is deleted, the docs remain valid, useful markdown.

| Level | Adds | Requires |
|---|---|---|
| L0 Format | `LORE.md`, nodes, claims | Nothing |
| L1 Markers | `@lore` comments in code | Nothing (grep) |
| L2 CLI | Lint, tiers, staleness, digests, navigation | A `lore` binary |
| L3 CI | Claims reached and invariant gates on every PR | A CI action |
| L4 Agent | Checks, reviews and benchmarks | A model |

## Status

Draft. [`SPEC.md`](SPEC.md) is v0.4. Trials so far: this repository (it documents itself, from [`LORE.md`](LORE.md)) and GameRelay's monorepo, where the first pass doubled as a code review, and a 45-case benchmark caught 27 of 27 deliberate breaks with no false confirmations.

## License

[MIT](LICENSE)
