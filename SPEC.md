# Lore Spec — v0.4 (draft)

> **L**inked **O**bservations, **R**ationale & **E**dges

Lore is a protocol for the knowledge code can't hold: why it is the way it is, what must stay
true, and what was tried and rejected. It is plain markdown in the repository, read mostly by
agents, and checked against the code on every change. This document is the whole protocol; every
tool is optional.

Key words **MUST**, **SHOULD** and **MAY** are used as in RFC 2119.

---

## 1. Purpose

Lore exists for three moments in an agent's work: <!-- @lore lore#DEC-6 -->

| Use | The agent asks | Lore answers with |
|---|---|---|
| **Plan** | What constraints does the area I'm about to change have, and how does it fit the system? | The map, then the claims anchored in that area: invariants to keep, decisions with what they rejected, notes (§7) |
| **Review** | What could this change break, and does it? | The claims the change reaches and what rests on them, each checked against the new code (§8) |
| **Context** | What here isn't visible in the code? | Only that: cheap to query, cheap to traverse, and never a restatement of the code (§7, §10) |

### 1.1 Intentions, ranked

When two pull against each other, the higher one wins.

1. **Stay true.** Every claim is checked against the code, and a stale claim surfaces instead of rotting. A wrong claim is worse than none: an agent acts on it with confidence.
2. **Protect what must not break.** A change, by a person or an agent, can't quietly violate an invariant.
3. **Capture what code can't say.** Why, what was decided, and what was rejected, so nobody re-litigates it. Tests guard behavior; they can't hold intent.
4. **The right context at the right cost.** An agent gets the constraints around what it's touching, at the depth it chooses, without reading everything.

All four are bounded by one constraint: **Lore must cost almost nothing to keep.** A feature that
needs authors to do more than write claims and markers will not be used, so it doesn't belong in
the core.

For example: truth outranks cost, so a digest may drop detail but never shows a claim as verified
when it isn't; protection outranks cost, so a review checks every invariant when that's affordable,
though selection is cheaper (§8).

### 1.2 Principles

1. **Document what code can't say.** Rationale, invariants, decisions and known behavior; never what is derivable from code. <!-- @lore see lore#DEC-1 -->
2. **Identity is not position.** IDs never encode where something sits, so structure can change freely. <!-- @lore format#INV-1 -->
3. **IDs are links.** Every reference resolves to a plain markdown link with no tooling. <!-- @lore format#INV-3 -->
4. **Progressive enhancement.** Deleting all tooling leaves the docs valid and useful. <!-- @lore lore#INV-1, layers#INV-1 -->
5. **Evidence lives in git.** Frontmatter holds only what a person writes and reads; caches live in `.lore/`. Verifications and acknowledgments are commit trailers, and stable IDs make a claim's history a `git log` away. <!-- @lore layers#INV-2 -->
6. **Small and closed at the core, open at the edges.** Few concepts, fixed; anything else goes in open sections, and tools ignore what they don't know. <!-- @lore layers#INV-3 -->
7. **Derive, don't declare.** Tools derive edges, staleness and history from what authors already write. Anything else an author must keep in step with the code goes stale, so declared links are optional hints, never required. <!-- @lore see lore#DEC-9 -->

Lore is not a call graph (a language server's job), not a test suite (it points at tests), and not
a wiki of what the code does.

## 2. Entry point and layout

Every graph starts at **`LORE.md`** in the repository root. It is the root node (ID `lore`): it
says which protocol version the graph follows, where the other nodes live, and, in its map, how
they nest.

```markdown
---
lore: 0.4
nodes: [docs]
gate: warn
---

# GameRelay

Multiplayer for single-file browser games: a relay that owns membership and an SDK that does the netcode.

## Map

- [protocol](docs/protocol.md)
- [room](docs/room.md)
  - [host-health](docs/host-health.md)
- [sdk](docs/sdk.md)
  - [entities](docs/entities.md)
```

- A repository has exactly one graph and one `LORE.md`, at its root.
- **`nodes`**: the node folders, relative to the root. Default `[docs]`. Each folder is flat (subfolders are ignored), holds only nodes and `_`-prefixed files, and node IDs are unique across all folders. <!-- @lore format#DEC-8 -->
- **`gate`**: `off` | `warn` (default) | `block`, the policy for invariant gates (§9).
- **`public`**: node folders that are a package's contract; an extension (§13.1).

### 2.1 The map is the tree

The `## Map` section of `LORE.md` is a nested list of links to nodes. Nesting is the zoom tree:
a node listed under another is its child. Each node SHOULD appear in the map exactly once; a node
not in the map is a child of `lore` (`L021`). <!-- @lore format#DEC-13 -->

The map is the only place hierarchy is declared. Every other edge is derived (§6).

## 3. Nodes

```markdown
---
covers: [apps/server/src/room/**]
verified: 2026-10-16
---

# Room

One room's rules: who hosts, who writes state, how seats survive a disconnect.

## Invariants

### INV-2
Only the host can set room state.

Anyone else gets `not_host`. Shared state is the host's simulation output; a second writer
would fork it.

- tests: apps/server/test/room.test.ts

## Decisions

### DEC-2
A returning ex-host doesn't take the role back.

Taking it back would move the simulation twice for one blip.
Rejected: restoring the original host on reconnect.

## Notes

### NOTE-1
The 64 KB state limit counts UTF-16 units, not bytes as frame limits do.

## How to run it locally

Anything that matters but isn't a claim goes in an open section.
```

- A node is a `.md` file in a node folder; its ID is its filename without `.md` (`[a-z][a-z0-9-]*`). `lore` is reserved for `LORE.md`.
- **Frontmatter** is optional and holds two fields: `covers` (globs of the files the node is about; drives node-level staleness, §5) and `verified` (the date a person or agent last confirmed the whole node). The node's verification commit is the commit that last changed its `verified:` line, found with `git blame`, never stored. <!-- @lore freshness#DEC-3 --> `LORE.md` adds `lore`, `nodes` and `gate` (and `public`, an extension, §13.1). Frontmatter is the YAML subset of §3.1; projects MAY add fields, and tools MUST ignore fields they don't know.
- **Body**, in order:
  1. One `# Title`.
  2. **The lead**: the first paragraph after the title. One sentence: what this node is about. Required (`L004`). <!-- @lore format#DEC-11 -->
  3. **Claim sections**: `## Invariants`, `## Decisions`, `## Notes` (§4).
  4. **Open sections**: any other `##` heading, as many as needed, anywhere after the lead. Tools never parse them for meaning; they MUST NOT contain claims (`L003`). <!-- @lore format#DEC-9 -->
- **Comments**: a blockquote that starts with who and when (`> **colin, 2026-10-16:** …`), under a claim or in a `## Comments` section. Lint ignores them; an agent MAY add its own and MUST NOT edit anyone else's. <!-- @lore format#DEC-10 -->
- **Size**: a node SHOULD stay under 300 lines (`L010`), and split into children in the map when it grows.

### 3.1 Frontmatter subset

One `key: value` per line; scalars are identifiers, numbers, dates (`2026-10-16`), durations
(`90d`) and globs, unquoted, or any text in double quotes; lists are flow lists (`[a, b]`).
Versions are strings: `lore: 0.10` is not `0.1`. Invalid YAML is `L015`; valid YAML outside the
subset is `L019`.

## 4. Claims

A claim is an `###` heading holding only its ID, followed by its statement. **The first paragraph
is the claim**: one sentence, at most 30 words (`L011`). Everything after it is rationale.

### 4.1 Kinds

A claim's kind is its contract with the reader, especially an agent:

| Prefix | Section | Kind | An agent… |
|---|---|---|---|
| `INV` | `## Invariants` | **Guardrail**: must always hold; breaking it is a bug | MUST NOT make a change that breaks it without changing the claim in the same change, and SHOULD check its diff against the invariants of files it touched |
| `DEC` | `## Decisions` | **Prior**: a choice made, and what it ruled out | SHOULD NOT propose an alternative named in its `Rejected:` line without new evidence, and says so when it does |
| `NOTE` | `## Notes` | **Context**: known behavior, limits, quirks and how parts meet | SHOULD take it into account |

<!-- @lore format#DEC-12 -->

- A `DEC` SHOULD have a line starting with `Rejected:` naming what was considered and why it lost (`L013`). <!-- @lore format#DEC-6 -->
- Plans are not claims. They belong in an issue tracker or plan document, linked from an open section.
- An invariant SHOULD state the guarantee, not enumerate the code: "no connection secret is reachable from a `relay`" outlives "a `relay` exposes only `playerId`, `room` and `party`", which breaks the first time a harmless getter is added.

### 4.2 IDs and references

- A claim ID is `<PREFIX>-<n>`, `n` unique per prefix within a node. Numbers are never reused, even after a claim is retired. <!-- @lore format#INV-2 -->
- References: `node#PREFIX-n` (full, valid anywhere), `PREFIX-n` (local, only inside its node), `node` (a node). Case-insensitive.
- A full reference maps to a link by rule: `<folder>/node.md#prefix-n`, with paths written relative to the file they appear in. A formatter MAY fix paths.
- Claims are never deleted: retire them with `status` and leave the heading as a tombstone.

### 4.3 Metadata

A claim MAY end with a list of `- key: value` items:

| Key | Meaning |
|---|---|
| `tests` | Tests that enforce the claim (comma-separated paths from the repository root). Each MUST exist (`L024`). |
| `files` | Files that uphold the claim but can't carry a marker (JSON, lockfiles, config). Each MUST exist (`L024`). |
| `depends` | Claims this one rests on (comma-separated full references). An optional hint (§1.2, principle 7). |
| `ask` | The question a check asks (§8), when the first paragraph doesn't make an obvious one. |
| `status` | `active` (default) \| `superseded` \| `retired` |
| `superseded_by` | The replacing claim. Implies `superseded`. |
| `review_after` | A date or duration after which the claim should be rechecked even if nothing changed. |
| `date` | For a claim recorded after the fact. |

Tools MUST ignore keys they don't know.

## 5. Anchors, trust and staleness

### 5.1 Markers

Any comment in any file MAY anchor a claim:

```ts
// @lore room#INV-2
if (from !== this.hostId) return this.error(conn, 'not_host', 'Only the host can set state')

// @lore see room#NOTE-1
```

- `@lore <ref>[, <ref>…]` says **this code upholds** those claims. `@lore see <ref>` is informational and never affects anything. <!-- @lore markers#DEC-4 -->
- References in markers MUST be full (`L006`). <!-- @lore markers#INV-1 -->
- A marker sits on the line above the code it anchors, or at the end of its first line. Its region runs to the next blank line or marker, at most 50 lines.
- In markdown, a marker MUST be inside an HTML comment, and markers inside fenced or inline code are ignored. <!-- @lore markers#DEC-3 -->
- Mark the definition a check relies on (the constant, the helper) as well as the check, when they are far apart.

### 5.2 Trust tiers

Only invariants have a trust tier, because only they can be enforced: <!-- @lore freshness#DEC-8 -->

| Tier | Condition |
|---|---|
| **tested** | A `tests:` path that exists, or a marker inside a test file. |
| **anchored** | A marker, or a `files:` path that exists. |
| **asserted** | Prose only. |

A check never raises a tier: an agent can confirm a false claim, so only tests make a claim
"tested". <!-- @lore freshness#DEC-6, freshness#NOTE-1 -->

### 5.3 Staleness

Given a diff, a claim is **affected** when:

| Signal | Severity |
|---|---|
| A changed hunk intersects a marker region of the claim | by kind: `INV` high, `DEC` medium, `NOTE` low |
| A marker for the claim was removed | high |
| A definition elsewhere in the same file that a marker region uses changed (MAY, for languages the tool reads) | as for the region |
| A `tests:` or `files:` path changed or was deleted | medium |
| A claim in its `depends:` was affected at high severity | low (one hop only, so nothing floods) |
| A file in its node's `covers` changed | low, for every claim in the node |

<!-- @lore freshness#DEC-7, freshness#DEC-9 -->

Detection MUST be deterministic and MUST NOT need a model. <!-- @lore freshness#INV-1 -->
`covers` SHOULD name the files a node is about, not files every change touches.

A change in a caller or another file reaches nothing (freshness#NOTE-2); see scope in §8.

## 6. The graph

- **The tree** is the map (§2.1).
- **Every other edge is derived** (principle 7): <!-- @lore format#DEC-13 -->

| Edge | From |
|---|---|
| depends on | a claim's `depends:` |
| mentions | a reference in a claim's statement or rationale |
| superseded by | `superseded_by` |
| same code | two claims whose marker regions in a non-markdown file overlap or sit at most one line apart, or share a `files:` entry; followed one hop only |

- **History** is derived from git: every commit whose message or diff mentions a claim's ID. Tools MAY add PR descriptions, issues and review comments. Nothing is declared twice. <!-- @lore see lore#DEC-7 -->
- Commits MAY carry trailers: `Lore-Claim: ref` (adds or changes a claim), `Lore-Ack: ref` (§9), `Lore-Verified: ref` (§8).

## 7. Reading

The read path serves planning and context (§1): orient cheaply, then go exactly as deep as the
change needs.

### 7.1 Zoom and digests

Every layer of a graph opens with a summary of the next: the `LORE.md` lead, the map, each node's
lead, each claim's first paragraph, then its rationale. So the graph renders at any depth by
keeping first paragraphs:

| Depth | Contains |
|---|---|
| 0 | `LORE.md`'s lead |
| 1 | The map with each node's lead |
| 2 | Plus every active claim's first paragraph, by kind |
| 3 | Plus rationale, metadata and open sections: the full text |

A **digest** is the graph rendered at a depth, optionally limited to a subtree or to the nodes
covering a set of files. <!-- @lore layers#DEC-5 -->

### 7.2 Navigation

L2 tools MUST also answer three queries, so an agent follows edges instead of reading files:

- **Show** a claim: its text, kind, tier, anchors (file and line) and every edge from §6. Or a node: its lead, children and claims.
- **Trace** from claims, a node, or a path (a file, directory or glob starts from every claim anchored there): the claims connected to it, breadth-first, each once at its nearest hop, with how it was reached. **Down** (the default) is what rests on the start, so what changing it can break; **up** is what it rests on. The walk is bounded by a depth the caller chooses, 3 hops by default; `same code` edges are followed one hop only (§6).
- **Find** claims by words, kind, node (with the nodes under it), anchored path or tier.

A planning agent reads the depth-1 digest (a few hundred words for a whole repository), traces the
files or nodes it expects to touch, and shows the claims it needs in full. <!-- @lore cli#DEC-9 -->

## 8. Review and the verification loop

A **review** answers "what could this change break, and does it?" It runs the verification loop
over a change:

1. **Select.** Staleness detection (§5.3) lists the claims the change reaches, with severity. Deterministic.
2. **Triage.** One model call reads the diff beside every active invariant (its statement and the guarantee its rationale gives) and names the ones the change could break, including through a code path it adds that no marker covers. Selection only sees what is marked; triage sees what is new. <!-- @lore layers#DEC-8 -->
3. **Check.** For each invariant selected or triaged, an agent reads the claim, its rationale, the code that upholds it, the same-file definitions that code uses, **and the diff**, and judges the change: **holds** (still true after it), **broken** (this change breaks or weakens it), **preexisting** (already broken before it, not made worse) or **unsure**. The verdict is about the guarantee the claim protects, in every path the change adds, not only its marked code or literal wording; and about what the code does, not what tests, comments or names say. A missing or unclear verdict is **unsure**, never holds. <!-- @lore cli#DEC-13 -->
4. **Record.**
   - **Agreement:** the claim is **verified** at that commit, recorded as a `Lore-Verified: ref` trailer or a line in the PR. Tools MUST NOT write the trailer for a claim no check judged to hold. A claim's freshness is measured from its latest verification, or its node's `verified` date, whichever is later. <!-- @lore freshness#DEC-5 -->
   - **Disagreement:** the gate fires (§9), and the review shows the agent's reasons. A `preexisting` verdict doesn't fail the change; it reports a claim to fix.

Step 1 and the asking and recording are deterministic (L3); triage and checks need a model (L4).
<!-- @lore layers#DEC-4 -->

**Scope.** Triage replaces checking every invariant: one call sees the whole graph against the
change, and the checks go where it points. If triage fails or answers nothing usable, a tool MUST
check every invariant rather than none. A tool MAY skip triage and check every invariant against
the change. Without a diff (a schedule, a new repository), a **sweep** checks every invariant
against the code as it is. <!-- @lore freshness#NOTE-2 -->

**Downstream.** A review lists what rests on each reached claim (trace down, §7.2). Lore names the
guarantees at stake; following the code from there is the reviewer's job.

**Decisions** MAY be checked too, with the question "does the code still do what this decided,
rather than what it rejected?" A tool SHOULD measure that template (§10) before checking decisions
by default. <!-- @lore see freshness#DEC-11 -->

**Pressure.** A claim that is acknowledged or fails checks often marks a place where the code
fights its own design. Tools SHOULD report the claims with the most acknowledgments.

## 9. Gates

When a change intersects the marker region of an active `INV` (or removes its marker, or changes a
`tests:` or `files:` path), the change MUST do one of:

- update the claim (its text, metadata or `status`) in the same change;
- carry `Lore-Ack: ref` (a commit trailer or a PR line), meaning "I know, and it still holds", optionally with a reason;
- be verified by the loop (§8).

A change that deletes a claim's heading from a node (an ID in a code example or a non-node file is
not a claim; a renamed node or `APP.md` becoming `LORE.md` keeps its claims) is always an unmet
gate, whatever trailers it carries:
claims are retired with `status`, never deleted, so their numbers are never reused. <!-- @lore format#INV-2 -->

Under `gate: warn`, an L3 tool reports unmet gates; under `block`, it fails the check; under `off`,
it does neither. An L3 tool SHOULD read the policy from the base branch, so a change can't loosen
its own gate. A bot's own commits never trigger a gate. <!-- @lore layers#DEC-6, layers#QRK-1 -->

## 10. Measuring trust

How far to trust a graph's reviews is a number to measure per repository, not a property to
assume. <!-- @lore freshness#DEC-10 -->

A **benchmark** is a set of cases, each an exact edit that breaks a claim or leaves it intact,
applied in a throwaway copy of the repository that the checking agent can't read the cases from.
Cases SHOULD include feature-sized changes (recorded diffs of real work) scored as whole reviews:
one-line breaks beside marked code flatter a review, because something already points at the claim.
It reports:

| Measure | Question | Where it points |
|---|---|---|
| **Selection recall** | Of the edits that break a claim, how many did selection reach? | Markers and §5.3 |
| **Selection noise** | How many other claims did each edit reach? | §5.3 heuristics |
| **False confirmations** | How often did a check say "holds" about a broken claim? | The check prompt; the one number that lets a break land |
| **False alarms** | How often did it say "broken" about a claim that holds? | Usually the claim's wording (§4.1) |
| **Inferability** | Which claims would an agent state unprompted, from the code where they're anchored, without the graph? | Principle 1: those restate the code |

**Inferability** is measured blind, then graded: in a copy of the repository with the graph
deleted and markers stripped, an agent is shown where a claim is anchored and asked a question for
its kind ("what must this code always preserve?", "what choice does it reflect, and what was
rejected?", "what would surprise someone?"), never the claim's own question, which would give the
answer away. A second step compares that answer with the claim: inferred, partial or missed. It
measures whether an agent would know the claim, not whether it could verify it; that is the check.
An inferred invariant still guards the code (intention 2); an inferred decision or note restates
it. Single verdicts vary between runs, so act on claims inferred in every run. <!-- @lore cli#DEC-12 -->

The outcome test is a task run: give an agent the same feature task with and without the graph,
and count the invariants it breaks.

Cases written by the same model that checks them measure only breaks it can imagine; cases from a
person or another model are the fairer test.

## 11. Lint

| Code | Level | Rule |
|---|---|---|
| `L001` | error | Reference to a nonexistent node or claim |
| `L002` | error | Duplicate claim ID within a node |
| `L003` | error | A known claim prefix (`INV`, `DEC`, `NOTE`, or a legacy one, §14.1) under the wrong section, or inside an open section |
| `L004` | error | Node without a lead paragraph |
| `L006` | error | Marker with a local reference or unknown verb |
| `L008` | warn | `review_after` has passed |
| `L010` | warn | Node over 300 lines |
| `L011` | warn | Claim's first paragraph over 30 words |
| `L012` | warn | Claim heading holds text besides the ID |
| `L013` | info | `DEC` without a `Rejected:` line |
| `L015` | error | Frontmatter isn't valid YAML |
| `L016` | error | The same node ID in two node folders |
| `L017` | error | A markdown file in a node folder that isn't a node |
| `L018` | error | `lore` version missing, or a major version the tool doesn't support |
| `L019` | warn | Frontmatter outside the subset (§3.1) |
| `L021` | warn | Node missing from the map, or listed twice |
| `L022` | error | A claim in a public folder references a non-public node (§13.1) |
| `L023` | warn | `depends:` points at a retired or superseded claim |
| `L024` | error | An active claim's `tests:` or `files:` path doesn't exist |

Codes are never reused, like claim numbers. Retired in v0.3: `L005`, `L007`, `L009`, `L014`, `L020`.

Tools MUST NOT report open sections, comments, unknown fields, unknown metadata keys, or headings with a prefix they don't know, wherever they appear: a newer minor version's claim kind is open text to an older tool.

## 12. Conformance levels

| Level | Adds | Requires |
|---|---|---|
| **L0** Format | §2–§4, §6 | Nothing |
| **L1** Markers | §5.1 | Nothing (grep) |
| **L2** CLI | Lint (§11), tiers and staleness (§5), reading (§7) | A `lore` binary |
| **L3** CI | Selection and gates on every PR (§8, §9) | A CI action |
| **L4** Agent | Checks and reviews (§8), benchmarks (§10) | A model |

An agent at any level MUST only edit nodes affected by its change, MUST NOT delete claims or others'
comments, and its changes go through normal review. Upgrading `lore:` is a human decision.
<!-- @lore layers#DEC-1 -->

## 13. Extensions

Features that serve a real need but that no trial has exercised yet. Tools MAY implement them; they
may change in any minor version until a trial uses them. <!-- @lore lore#DEC-8 -->

### 13.1 Public folders

`LORE.md` MAY list **`public`** node folders: claims that are part of a package's contract with its
users, shipped with the package. <!-- @lore lore#DEC-3 -->

- A claim in a public folder MUST NOT reference a node outside the public folders (`L022`), so the folder can be read on its own.
- Retiring or superseding an `INV` in a public folder, or rewriting its first paragraph, is a breaking change. L3 tools SHOULD say so on the PR.
- Tools MAY generate agent-facing docs (an `llms.txt`, say) from public folders at a chosen depth (§7.1).

### 13.2 Push

An editor or agent hook MAY inject the digest of the claims covering a file when an agent opens it.

## 14. Versioning

- `LORE.md` declares `lore: <major>.<minor>` (`L018`). Each version is tagged in this repository as `v<major>.<minor>`.
- **From 1.0**, a minor version only adds; a major version may change anything and ships migration notes. **Before 1.0**, any minor may break, with migration notes. <!-- @lore layers#DEC-3 -->
- Tools ignore what they don't know (fields, keys, sections, claim prefixes), and MUST read every minor version of the majors they support.

### 14.1 Reading earlier graphs

Tools MUST read v0.1 to v0.3 graphs:

- **Root:** `APP.md` when there's no `LORE.md`; `app` is an alias of `lore`; `.lore/config.json`'s `dir` acts as `nodes`.
- **Frontmatter:** `summary`, when present, is the node's lead, and the first paragraph is read as context (in v0.1 graphs it was often a pointer to longer docs); `parent` places a node in the tree when the map doesn't list it; `scope`, `links` and `status` are ignored.
- **Claim types:** `LIM`, `QRK` and `EDGE`, under `## Limits`, `## Quirks` and `## Edges`, and `PLAN` under `## Plans`, are read as `NOTE` kind and keep their IDs. New claims use `NOTE`. Renumbering would break references, so migration never does it.
- **Markers:** `enforces` and `implements` are read as plain `@lore`.

### 14.2 Migrating

- **v0.3 → v0.4:** set `lore: 0.4`. Nothing else changes in the format; `public` is now an extension (§13.1) and reads the same.
- **v0.2 → v0.3:** add a `## Map` with every node nested where its `parent` said; delete `scope`, `parent`, `links`, `status` and `summary` (moving any summary into the lead); drop the verbs from markers. Keep every claim ID. A formatter MAY do all of it.

## 15. Open questions

- **Independent cases.** Checks gave no false confirmations in 53 checks of broken claims on GameRelay (§10), but the same model wrote the breaks. How do checks do on cases a person writes?
- **Decision checks.** Does the decision template (§8) find real drift, or only noise?
- **Triage misses.** Triage found every expected break in the first benchmarks (§10); how often does it skip a claim a change really breaks, on graphs of hundreds of invariants?
- **Inferable decisions.** On GameRelay, 4 of 26 decisions were inferred from the code in both of two runs, because a code comment already gave the reason. Should a decision whose reason lives in a comment leave the graph, or stay as the one place that names what was rejected?
- **Goodhart.** Will authors write claims that are easy to verify rather than important? Inferability is one guard.
- **Ignored paths.** Test fixtures and generated code hold example markers. A root `ignore:` list, or nothing until a second repository needs it?
- **Cross-repo references.** Should another repository be able to reference a public folder's claims?
- **Extensions.** Should `LORE.md` declare more claim kinds (a `RISK`, an `SLO`), each saying which existing kind it behaves as? Not until two trials ask for the same one.
- **Marker regions.** Is 50 lines enough before tree-sitter adapters?

## 16. Changelog

### v0.4 (2026-10-16, draft)

From a benchmark of the loop on GameRelay (asleepace/gamerelay.io#225) and a review of v0.3
against what the trials used. No format change; the spec is reorganized around what Lore is for.

- **Purpose** (§1): three uses (plan, review, context) and four ranked intentions, bounded by "costs almost nothing to keep". They replace v0.3's seven goals: zoom, action semantics, gates, blast radius and self-evaluation serve the uses; **history** follows from git (principle 5); **contract** is an extension.
- **Principle 7, derive, don't declare.** On GameRelay, nothing declared a `depends:` and 43 of 68 claims had no edge; everything that worked was derived from code. `depends:` stays, as an optional hint.
- **Reading** (§7.2): show, trace and find, required at L2.
- **Reviews** (§8) check every invariant when that's affordable, with selection ordering them: selection reached 17 of 27 deliberate breaks, checks of every invariant caught 27. Checks see same-file definitions and judge the code over tests and names, which took false confirmations from 3 in 47 to 0 in 53. Decision checks MAY, once measured.
- **Same-file definitions** a marker region uses reach its claim (§5.3, MAY).
- **Same-code edges** count only non-markdown regions: adjacent markers in a spec's prose are not shared code.
- **Measuring trust** (§10): recall, noise, false confirmations, false alarms, inferability, and a task run.
- **Extensions** (§13): public folders and push, until a trial uses them. L5 is gone from conformance.
- Invariants SHOULD state guarantees, not enumerate code (§4.1). Versions are strings (§3.1).
- `tests:` and `files:` paths must exist (`L024`), and only existing paths count toward a tier (§5.2): a deleted test no longer leaves its claim "tested".

### v0.3 (2026-10-16)

Three claim kinds (`INV`, `DEC`, `NOTE`) with what an agent does with each; the map as the tree;
frontmatter as `covers` and `verified`; markers without verbs; tiers for invariants only; `files:`
and `depends:`; digests at depths 0–3; the verification loop and gates with `Lore-Ack:` and
`Lore-Verified:` trailers; public folders; lint `L021`–`L023`, retiring `L005`, `L007`, `L009`,
`L014` and `L020`.

### v0.2 (2026-10-16)

`LORE.md` entry point with node-folder routing; protocol versioning; open sections and comments;
the summary as the lead paragraph; frontmatter as a YAML subset; narrow `covers`; lint
`L015`–`L020`. From the GameRelay trial (asleepace/gamerelay.io#225).

### v0.1 (2026-10-15)

`verified` dates via `git blame`; markers in markdown; tierless decisions; `Rejected:` lines;
section order as a recommendation; optional `date`.
