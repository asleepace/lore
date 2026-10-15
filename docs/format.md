---
scope: domain
parent: app
summary: Why nodes, claims and IDs are shaped the way they are.
covers: [SPEC.md]
links:
  - { to: markers, rel: related, note: "markers use the same full reference form" }
verified: 2026-10-15
review_after: 90d
---

# Format

## Invariants

### INV-1
An ID never encodes where its node or claim sits in the graph.

Structure lives in `parent:` and `links:`, which can change freely. If position were part of the ID, every restructure would break every reference and every code marker.

### INV-2
A claim number is never reused, even after the claim is retired.

A reused number would silently re-point old references, commit trailers and code markers at a different claim.

### INV-3
Every reference resolves to a plain markdown link without tooling.

Holds for references between nodes in `docs/`. See QRK-2 for the one place it gets awkward.

## Decisions

### DEC-1
Claim IDs are typed (`INV-1`, `DEC-3`) rather than hierarchical Dewey-style numbers.

The type tells a reader how to treat a claim before reading it: an `INV` must not break, a `PLAN` may be stale.
Rejected: Dewey-style positional IDs, which break on restructure (INV-1). Rejected: Luhmann-style branching IDs, which are stable but carry no meaning.

### DEC-2
A node's ID is its filename, and frontmatter does not repeat it.

A second copy of the ID can only drift from the first. A flat `docs/` folder means the filesystem enforces uniqueness for free.
Rejected: an `id:` frontmatter field.

### DEC-3
A claim heading contains only its ID.

GitHub builds anchors from the full heading text, so `### INV-1 No unmoderated posts` anchors at `#inv-1-no-unmoderated-posts` and breaks whenever the wording changes. The first paragraph carries the statement instead.
Rejected: titled headings with explicit `<a id="inv-1">` anchors, which are noisy and easy to forget.

### DEC-4
`#` separates a node from a claim in references.

`moderation#INV-1` is the link `moderation.md#inv-1` minus the extension, so there is one mental model. It does not clash in practice: shell only treats `#` as a comment after whitespace, GitHub only autolinks numeric `#123`, and Obsidian only tags after whitespace.
Rejected: `:`, which is easier to regex but breaks the ID-is-a-link model.

### DEC-5
`docs/` stays flat; the zoom tree lives in `parent:`.

A graph forced into folders gets one hierarchy baked into paths, and moving a node changes its path.
Rejected: nested folders like `docs/security/moderation.md`.

### DEC-6
Decisions record what was rejected, on a line starting with `Rejected:`.

The convention appeared unprompted in 7 of 13 decisions while dogfooding v0. It's often the most useful line for an agent, because it stops ideas already ruled out from being proposed again.
Rejected: a `rejected:` metadata key, which squeezes reasoning into a one-line value.

### DEC-7
Claim section order is a recommendation, not a lint error.

Writing naturally broke the fixed order in 3 of 4 nodes, and the order tells an agent nothing. A formatter can sort sections.
Rejected: strict order as an error (v0).

## Limits

### LIM-1
Renaming a node breaks every reference to it.

Node IDs are filenames (DEC-2), and there is no redirect mechanism yet.

## Quirks

### QRK-1
Reference matching is case-insensitive.

IDs are written uppercase for readability, but GitHub lowercases anchors.

### QRK-2
The same reference needs a different link path in `APP.md` than in `docs/` nodes.

From `APP.md`, `format#DEC-1` is `docs/format.md#dec-1`; from inside `docs/`, it is `format.md#dec-1`. Root-to-node links are the only ones that break the "ID minus extension" rule.
