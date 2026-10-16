---
scope: domain
parent: lore
covers: [SPEC.md]
links:
  - { to: markers, rel: related, note: "markers use the same full reference form" }
verified: 2026-10-16
review_after: 90d
---

# Format

Why nodes, claims and IDs are shaped the way they are, where nodes live, and what else a node may hold.

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
Each node folder stays flat; the zoom tree lives in `parent:`.

A graph forced into folders gets one hierarchy baked into paths, and moving a node changes its path. v0.2 allows several node folders (DEC-8), each still flat.
Rejected: nested folders like `docs/security/moderation.md`.

### DEC-6
Decisions record what was rejected, on a line starting with `Rejected:`.

The convention appeared unprompted in 7 of 13 decisions while dogfooding v0. It's often the most useful line for an agent, because it stops ideas already ruled out from being proposed again.
Rejected: a `rejected:` metadata key, which squeezes reasoning into a one-line value.

### DEC-7
Claim section order is a recommendation, not a lint error.

Writing naturally broke the fixed order in 3 of 4 nodes, and the order tells an agent nothing. A formatter can sort sections.
Rejected: strict order as an error (v0).

### DEC-8
`LORE.md` at the repository root is the one entry point and root node; its `nodes:` list routes to the folders that hold the rest.

Projects differ. In the GameRelay trial `docs/` already held a dozen narrative documents, so v0.1 needed a config file to put nodes elsewhere; a monorepo or a published package wants nodes next to its code. One fixed entry file means a reader or tool always knows where to start, and the routing says the rest in the same file a human reads first.
Rejected: `APP.md` with `.lore/config.json` (v0.1), which split the graph's entry across two files and named it after one kind of project. Rejected: nested graphs per folder, which breaks one graph per repository ([lore#DEC-2](../LORE.md#dec-2)).

### DEC-9
A node may hold open sections of any name, anywhere, for what isn't a claim.

Some things that matter don't fit six claim types: a glossary, a diagram, open questions, how to run something locally. Without a place for them they end up forced into claims, or in another file nobody links. Tools don't parse open sections, so they cost nothing to allow.
Rejected: a fixed list of allowed free-form sections. Rejected: free-form text only before the claims (v0.1), which pushed notes that belong next to a claim away from it.

### DEC-10
Comments are signed blockquotes on a claim, or a `## Comments` section on a node, and lint ignores them.

People want to leave a doubt or a "this bit us again" next to a claim without rewriting it. A blockquote renders as an aside, needs no tooling, and the signature says whose it is, so an agent can add its own but never edit someone else's.
Rejected: comments as a seventh claim type with IDs, which makes every remark permanent and numbered. Rejected: HTML comments only, which hide them from the people they're for.

### DEC-11
A node's summary is its lead paragraph, and frontmatter holds only structured values in a small YAML subset.

In the GameRelay trial 6 of 11 frontmatter summaries were invalid YAML, because sentences have colons. Prose in markdown can't break, reads naturally on GitHub, and follows the rule claims already use: the first paragraph is the statement. With no prose left in frontmatter, Lore can define the subset it accepts and give precise errors.
Rejected: quoting `summary` (an earlier v0.2 draft), which keeps a trap every author falls into once. Rejected: letting each repo choose its metadata format (YAML, TOML, JSON), which splits tools and repos into dialects.

## Limits

### LIM-1
Renaming a node breaks every reference to it.

Node IDs are filenames (DEC-2), and there is no redirect mechanism yet.

> **agent (Claude), 2026-10-16:** Renaming the root from `APP.md` to `LORE.md` in v0.2 hit this: the spec keeps `app` as an alias of `lore` (SPEC.md §2.2) so existing references keep working. The same alias idea could become the general rename mechanism.

## Quirks

### QRK-1
Reference matching is case-insensitive.

IDs are written uppercase for readability, but GitHub lowercases anchors.

### QRK-2
The same reference needs a different link path depending on the file it's written in.

From `LORE.md`, `format#DEC-1` is `docs/format.md#dec-1`; from inside `docs/`, it is `format.md#dec-1`; from a node to the root it is `../LORE.md#…`; across node folders it's a relative path between them. Only links within one folder follow the plain "ID minus extension" rule, so v0.2 says paths are relative to the file and a formatter may fix them.

> **agent (Claude), 2026-10-16:** The GameRelay trial used all three forms within its first ten nodes; this quirk is the one authors hit first.
