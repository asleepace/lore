---
covers: [SPEC.md]
verified: 2026-10-16
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

> **agent (Claude, `lore check --sweep`), 2026-10-16:** Unsure. Gates now refuse a deleted heading (`cli/src/gate.ts`), but only for changes that go through a gate, not under `gate: off` or in a bot's commits, and not a deletion and reuse of the same ID within one change. Fully enforcing it needs history: the highest number ever used per prefix.

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

- status: superseded
- superseded_by: format#DEC-13

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

### DEC-12
There are three claim kinds (`INV`, `DEC`, `NOTE`), and each tells an agent how to act: a guardrail, a prior, context.

In the GameRelay trial, classifying claims among six types cost the most time for the least value: `EDGE` was used once, and limits, quirks and parts of invariants blurred together. What the reader needs from a kind is what to do with it: don't break it, don't re-propose what it rejected, or take it into account. Three kinds answer that; `NOTE` absorbs limits, quirks and edges. Plans left claims entirely: every trial plan pointed at another document.
Rejected: keeping six types (v0.2). Rejected: two kinds (rules and notes), which loses the `Rejected:` line's home and the "don't re-propose" behavior.

### DEC-13
The map in `LORE.md` is the tree, and every other edge in the graph is derived from references.

`parent:` brought back the single hierarchy DEC-5 kept out of folders (the trial had to pick whether host health belonged to the room or the SDK), and most nodes hung off the root anyway. `links:` restated references already in the prose. A nested list in one file is the whole hierarchy, readable by a person, and moving a node is a one-line edit; references in prose, markers, `depends:`, commits and PRs give the rest of the graph without declaring it twice.
Rejected: `parent:` and `links:` (v0.2). Rejected: no tree at all, which loses depth-1 digests and the reading order a map gives.

### DEC-14
Node frontmatter holds two fields, `covers` and `verified`.

The trial used `scope` to decide nothing, and its tree depth says the same. With the tree in the map, links derived and the summary in the lead, nothing else needs to be structured per node. Less frontmatter also means less YAML to break (DEC-11).
Rejected: keeping `scope`, `parent`, `links` and node `status` as optional fields, which keeps every author deciding whether to fill them.

## Limits

### LIM-1
Renaming a node breaks every reference to it.

Node IDs are filenames (DEC-2), and there is no redirect mechanism yet.

> **agent (Claude), 2026-10-16:** Renaming the root from `APP.md` to `LORE.md` in v0.2 hit this: the spec keeps `app` as an alias of `lore` (SPEC.md §12.1) so existing references keep working. The same alias idea could become the general rename mechanism.

## Quirks

### QRK-1
Reference matching is case-insensitive.

IDs are written uppercase for readability, but GitHub lowercases anchors.

### QRK-2
The same reference needs a different link path depending on the file it's written in.

From `LORE.md`, `format#DEC-1` is `docs/format.md#dec-1`; from inside `docs/`, it is `format.md#dec-1`; from a node to the root it is `../LORE.md#…`; across node folders it's a relative path between them. Only links within one folder follow the plain "ID minus extension" rule, so v0.2 says paths are relative to the file and a formatter may fix them.

> **agent (Claude), 2026-10-16:** The GameRelay trial used all three forms within its first ten nodes; this quirk is the one authors hit first.
