# Lore

> **L**inked **O**bservations, **R**ationale & **E**dges

A living, agent-maintained knowledge graph for a codebase, written in plain markdown and checked into git.

Lore captures what code can't say: the **why**, the **invariants**, the **decisions**, the **edge cases** where modules meet, and the **quirks** you only learn by breaking them. It doesn't restate what the code already does.

## Core ideas

- **Repo-scoped graph.** `APP.md` is the entry point. Every file in a flat `docs/` folder is a node, and the filename is its ID.
- **Typed, stable claim IDs.** Claims are headings like `### INV-1` under `## <Type>` sections, addressed as `node#TYPE-n` (e.g. `moderation#INV-1`). Numbers are never reused; retired claims stay as tombstones.
  - `INV` invariant · `DEC` decision · `EDGE` module interaction · `LIM` known limit · `QRK` quirk · `PLAN` future work
- **IDs are links.** `moderation#INV-1` resolves to `docs/moderation.md#inv-1`, so it works natively on GitHub and in editors.
- **Code points at claims.** Language-agnostic marker comments tie code to the docs:
  ```ts
  // @lore enforces moderation#INV-1
  ```
  The verb sets how strongly a code change flags the claim: `enforces` > `implements` > `see`.
- **Freshness is the core feature.** Staleness is detected deterministically from diffs, `covers:` globs and markers. Agents propose updates; humans approve them in PR review.

## Progressive enhancement

Every layer is opt-in. If all tooling is deleted, the docs remain valid, useful markdown.

| Level | Adds | Requires |
|---|---|---|
| L0 Format | `APP.md`, nodes, frontmatter, claim IDs | Nothing |
| L1 Markers | `@lore` comments in code | Nothing (grep) |
| L2 CLI | Lint, staleness, graph queries | Local binary |
| L3 CI | Diff → affected claims | GitHub Action |
| L4 Agent | Proposed doc updates on PRs | API key |
| L5 Push | Context injection when agents open files | Claude Code hook / MCP |

## Status

Early design. `SPEC.md` (v0) is next.

## License

[MIT](LICENSE)
