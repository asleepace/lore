# Lore

> **L**inked **O**bservations, **R**ationale & **E**dges

A protocol for the knowledge code can't hold: why it is the way it is, what must stay true, and what was tried and rejected. Plain markdown in the repository, read mostly by agents, and kept honest by checks that run on every change.

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
- **One entry point.** `LORE.md` at the root holds the protocol version, the folders that hold nodes, and a map that is the whole hierarchy. Every other edge is derived from references, including commits and PRs.
- **Zoom.** Every layer opens with a summary of the next, so a graph renders at any depth: a page to orient, claim sentences for the area being changed, full text for what a change might break.
- **The verification loop.** A change selects the claims it might break (deterministically), each becomes a question, an agent checks it against the new code, and only mismatches reach a person. Documentation that tests itself.

## Tools

[`cli/`](cli/) is `lore`: small commands for each step of the loop (`lint`, `digest`, `select`, `ask`,
`check`, `gate`, `record`, `history`), for navigating the graph without reading whole files
(`show`, `trace`, `find`), and for measuring how far to trust the loop (`bench`); the same as MCP
tools for agents (`lore mcp`), and a GitHub Action ([`action.yml`](action.yml)) for pull requests.

## Progressive enhancement

Every layer is opt-in. If all tooling is deleted, the docs remain valid, useful markdown.

| Level | Adds | Requires |
|---|---|---|
| L0 Format | `LORE.md`, nodes, claims | Nothing |
| L1 Markers | `@lore` comments in code | Nothing (grep) |
| L2 CLI | Lint, trust tiers, staleness, digests | A `lore` binary |
| L3 CI | Affected claims and invariant gates on every PR | A CI action |
| L4 Agent | Claim checks and self-evaluation | A model |
| L5 Push | The claims covering a file, injected when an agent opens it | An editor or agent hook |

## Status

Draft. [`SPEC.md`](SPEC.md) is v0.3. Trials so far: this repository (it documents itself, from [`LORE.md`](LORE.md)) and GameRelay's monorepo, where the first pass doubled as a code review: writing exact claims surfaced an inconsistency nobody had noticed.

## License

[MIT](LICENSE)
