# Lore Spec — v0.3 (draft)

> **L**inked **O**bservations, **R**ationale & **E**dges

Lore is a protocol for the knowledge code can't hold: why it is the way it is, what must stay
true, and what was tried and rejected. It is written as plain markdown in the repository, read
mostly by agents, and kept honest by checks that run on every change. This document is the whole
protocol; every tool is optional.

Key words **MUST**, **SHOULD** and **MAY** are used as in RFC 2119.

---

## 1. Goals

A Lore graph is a set of **claims**: short statements with stable IDs, each anchored to the code
or tests that uphold it. The format is shaped so that these follow from it, without extra work by
authors:

| Goal | What it means | Where |
|---|---|---|
| **Zoom** | The graph can be read at any depth, from one page to everything, because every layer starts with a summary of the next. | §7 |
| **Action semantics** | A claim's kind tells an agent how to treat it: a guardrail, a prior or context. | §4 |
| **Gates** | A change to code that upholds an invariant can't land silently. | §9 |
| **History** | Anything that mentions a claim (a commit, a PR, an issue) joins its history; nothing is declared. | §6 |
| **Self-evaluation** | Every claim is a question with a known answer, so the graph yields its own test of an agent's understanding. | §8 |
| **Contract** | A package's public claims ship with it, and weakening one is a breaking change. | §2.2 |
| **Blast radius** | Claims say what they depend on, so a change flags what rests on it. | §5.3 |

Together they form the **verification loop** (§8): a change selects the claims it might break,
each claim is checked against the new code, and only mismatches reach a human. Documentation that
tests itself is the point of Lore; the rest is how it gets there.

### 1.1 Principles

1. **Document what code can't say.** Rationale, invariants, decisions and known behavior. Never what is derivable from code. <!-- @lore see lore#DEC-1 -->
2. **Identity is not position.** IDs never encode where something sits. Structure can change freely. <!-- @lore format#INV-1 -->
3. **IDs are links.** Every reference resolves to a plain markdown link with no tooling. <!-- @lore format#INV-3 -->
4. **Progressive enhancement.** Deleting all tooling leaves the docs valid and useful. <!-- @lore lore#INV-1, layers#INV-1 -->
5. **No tool state in docs.** Frontmatter holds only what a person writes and reads. Indexes and caches live in `.lore/`; evidence lives in git (§8). <!-- @lore layers#INV-2 -->
6. **Small and closed at the core, open at the edges.** Few concepts, fixed; anything else goes in open sections, and tools ignore what they don't know. <!-- @lore layers#INV-3 -->

## 2. Entry point and layout

Every graph starts at **`LORE.md`** in the repository root. It is the root node (ID `lore`): it
says which protocol version the graph follows, where the other nodes live, and, in its map, how
they nest.

```markdown
---
lore: 0.3
nodes: [docs, packages/sdk/lore]
public: [packages/sdk/lore]
gate: warn
---

# GameRelay

Multiplayer for single-file browser games: a relay that owns membership and an SDK that does the netcode.

## Map

- [protocol](docs/protocol.md)
- [room](docs/room.md)
  - [host-health](docs/host-health.md)
- [sdk](packages/sdk/lore/sdk.md)
  - [entities](packages/sdk/lore/entities.md)
```

- A repository has exactly one graph and one `LORE.md`, at its root.
- **`nodes`**: the node folders, relative to the root. Default `[docs]`. Each folder is flat (subfolders are ignored), holds only nodes and `_`-prefixed files, and node IDs are unique across all folders. <!-- @lore format#DEC-8 -->
- **`public`**: node folders that are part of a published contract (§2.2). Default none.
- **`gate`**: `off` | `warn` (default) | `block`, the policy for invariant gates (§9).

### 2.1 The map is the tree

The `## Map` section of `LORE.md` is a nested list of links to nodes. Nesting is the zoom tree:
a node listed under another is its child. Each node SHOULD appear in the map exactly once; a node
not in the map is a child of `lore` (`L021`). <!-- @lore format#DEC-13 -->

The map is the only place hierarchy is declared. Everything else in the graph (which node relates
to which) is derived from references (§6).

### 2.2 Public folders

A node folder listed in `public` holds claims that are part of a package's contract with its users,
and ships with the package. <!-- @lore lore#DEC-3 -->

- A claim in a public folder MUST NOT reference a node outside the public folders (`L022`), so the
  folder can be read on its own.
- Retiring or superseding an `INV` in a public folder, or rewriting its first paragraph, is a
  **breaking change**. L3 tools SHOULD say so on the PR.
- Tools MAY generate agent-facing docs (an `llms.txt`, say) from public folders at a chosen depth (§7).

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
- **Frontmatter** is optional and holds two fields: `covers` (globs of the files the node is about; drives node-level staleness, §5) and `verified` (the date a person or agent last confirmed the whole node). The node's verification commit is the commit that last changed its `verified:` line, found with `git blame`, never stored. <!-- @lore freshness#DEC-3 --> `LORE.md` adds `lore`, `nodes`, `public` and `gate`. Frontmatter is the YAML subset of §3.1; projects MAY add fields, and tools MUST ignore fields they don't know.
- **Body**, in order:
  1. One `# Title`.
  2. **The lead**: the first paragraph after the title. One sentence: what this node is about. Required (`L004`). <!-- @lore format#DEC-11 -->
  3. **Claim sections**: `## Invariants`, `## Decisions`, `## Notes` (§4).
  4. **Open sections**: any other `##` heading, as many as needed, anywhere after the lead. Tools never parse them for meaning; they MUST NOT contain claims (`L003`). <!-- @lore format#DEC-9 -->
- **Comments**: a blockquote that starts with who and when (`> **colin, 2026-10-16:** …`), under a claim or in a `## Comments` section. Lint ignores them; an agent MAY add its own and MUST NOT edit anyone else's. <!-- @lore format#DEC-10 -->
- **Size**: a node SHOULD stay under 300 lines (`L010`), and split into children in the map when it grows.

### 3.1 Frontmatter subset

One `key: value` per line; scalars are identifiers, numbers, dates (`2026-10-16`), durations
(`90d`) and globs, unquoted, or any text in double quotes; lists are flow lists (`[a, b]`). Invalid
YAML is `L015`; valid YAML outside the subset is `L019`.

## 4. Claims

A claim is an `###` heading holding only its ID, followed by its statement. **The first paragraph
is the claim**: one sentence, at most 30 words (`L011`). Everything after it is rationale.

### 4.1 Kinds

There are three kinds. A claim's kind is its contract with the reader, especially an agent:

| Prefix | Section | Kind | An agent… |
|---|---|---|---|
| `INV` | `## Invariants` | **Guardrail**: must always hold; breaking it is a bug | MUST NOT make a change that breaks it without changing the claim in the same change, and SHOULD check its diff against the invariants of files it touched |
| `DEC` | `## Decisions` | **Prior**: a choice made, and what it ruled out | SHOULD NOT propose an alternative named in its `Rejected:` line without new evidence, and says so when it does |
| `NOTE` | `## Notes` | **Context**: known behavior, limits, quirks and how parts meet | SHOULD take it into account |

<!-- @lore format#DEC-12 -->

- A `DEC` SHOULD have a line starting with `Rejected:` naming what was considered and why it lost (`L013`). <!-- @lore format#DEC-6 -->
- Plans are not claims. They belong in an issue tracker or plan document, linked from an open section.

### 4.2 IDs and references

- A claim ID is `<PREFIX>-<n>`, `n` unique per prefix within a node. Numbers are never reused, even after a claim is retired. <!-- @lore format#INV-2 -->
- References: `node#PREFIX-n` (full, valid anywhere), `PREFIX-n` (local, only inside its node), `node` (a node). Case-insensitive.
- A full reference maps to a link by rule: `<folder>/node.md#prefix-n`, with paths written relative to the file they appear in. A formatter MAY fix paths.
- Claims are never deleted: retire them with `status` and leave the heading as a tombstone.

### 4.3 Metadata

A claim MAY end with a list of `- key: value` items:

| Key | Meaning |
|---|---|
| `tests` | Tests that enforce the claim (comma-separated paths). |
| `files` | Files that uphold the claim but can't carry a marker (JSON, lockfiles, config). |
| `depends` | Claims this one rests on (comma-separated full references). Drives blast radius (§5.3). |
| `ask` | The question for self-evaluation (§8), when the first paragraph doesn't make an obvious one. |
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

### 5.2 Trust tiers

Only invariants have a trust tier, because only they can be enforced: <!-- @lore freshness#DEC-8 -->

| Tier | Condition |
|---|---|
| **tested** | A `tests:` entry, or a marker inside a test file. |
| **anchored** | A marker, or a `files:` entry. |
| **asserted** | Prose only. |

<!-- @lore freshness#DEC-6 -->

### 5.3 Staleness

Given a diff, a claim is **affected** when:

| Signal | Severity |
|---|---|
| A changed hunk intersects a marker region of the claim | by kind: `INV` high, `DEC` medium, `NOTE` low |
| A marker for the claim was removed | high |
| A `tests:` or `files:` path changed or was deleted | medium |
| A definition elsewhere in the same file that a marker region uses changed (MAY, for languages the tool reads) | as for the region |
| A claim in its `depends:` was affected at high severity | low (one hop only, so nothing floods) |
| A file in its node's `covers` changed | low, for every claim in the node |

<!-- @lore freshness#DEC-7 -->

Detection MUST be deterministic and MUST NOT need an LLM. <!-- @lore freshness#INV-1 -->
`covers` SHOULD name the files a node is about, not files every change touches.

## 6. The graph

- **The tree** is the map (§2.1).
- **Every other edge is derived** from references: in prose, in markers, in `depends:`, and in any text a tool can read alongside the repository: commit messages, PR descriptions, issues, review comments. A reference anywhere puts that text into the claim's **history**. Nothing is declared twice. <!-- @lore format#DEC-13 -->
- Commits MAY carry trailers: `Lore-Claim: ref` (adds or changes a claim), `Lore-Ack: ref` (§9), `Lore-Verified: ref` (§8).

## 7. Zoom and digests

Every layer of a graph opens with a summary of the next: the `LORE.md` lead, the map, each node's
lead, each claim's first paragraph, then its rationale. So the graph can be rendered at any depth
by keeping first paragraphs:

| Depth | Contains |
|---|---|
| 0 | `LORE.md`'s lead |
| 1 | The map with each node's lead |
| 2 | Plus every active claim's first paragraph, by kind |
| 3 | Plus rationale, metadata and open sections: the full text |

A **digest** is the graph rendered at a depth, optionally limited to a subtree or to the nodes
covering a set of files. L2 tools MUST be able to produce one. Digests are how agents load a
repository: depth 1 to orient, depth 2 for the area they're changing, depth 3 for the claims they
might break. <!-- @lore layers#DEC-5 -->

## 8. The verification loop

1. **Select.** For a diff, staleness detection (§5.3) lists the affected claims. Deterministic.
2. **Ask.** Each affected claim becomes a question: its `ask:`, or one built from its first paragraph by a fixed template per kind. The question says where to look; it is deterministic, so two runs ask the same thing.
3. **Check.** An agent reads the claim, its question and the code that upholds it, and gives a verdict: **holds**, **broken** or **unsure**. The verdict is always about the claim, never about the wording of the question.
4. **Record.**
   - **Agreement:** the claim is **verified** at that commit, recorded as a `Lore-Verified: ref` trailer on the commit or a line in the PR. Git holds the evidence, not the docs. A claim's freshness is measured from its latest verification, or its node's `verified` date, whichever is later. <!-- @lore freshness#DEC-5 -->
   - **Disagreement:** the gate fires (§9).

Steps 1, 2 and 4 are deterministic (L3); only step 3 needs a model (L4), so a repository without one
still gets selection, questions and gates. <!-- @lore layers#DEC-4 -->

- **A check never raises a tier.** It refreshes freshness only: an agent can confirm a false claim, so only tests make a claim "tested". <!-- @lore freshness#NOTE-1 -->
- **Self-evaluation.** The same questions, asked without a diff, form a benchmark of how well an agent understands the repository at each depth. Its score at depth 1, 2 and 3 says how much context the repository needs, and is a health signal worth tracking over time.
- **Sweep.** Selection only sees marker regions, so a change to code a claim relies on elsewhere (a constant defined far from the check that uses it) reaches nothing. An L4 tool SHOULD also check every active invariant on a schedule, whatever changed. Marking definitions as well as checks narrows the gap. <!-- @lore freshness#NOTE-2 -->
- **Pressure.** A claim that is acknowledged or fails checks often marks a place where the code fights its own design. Tools SHOULD report the claims with the most acknowledgments.

## 9. Gates

When a change intersects the marker region of an active `INV` (or removes its marker, or changes a
`tests:` or `files:` path), the change MUST do one of:

- update the claim (its text, metadata or `status`) in the same change;
- carry `Lore-Ack: ref` (a commit trailer or a PR line), meaning "I know, and it still holds", optionally with a reason;
- be verified by the loop (§8).

A change that deletes a claim's heading is always an unmet gate, whatever trailers it carries:
claims are retired with `status`, never deleted, so their numbers are never reused. <!-- @lore format#INV-2 -->

Under `gate: warn`, an L3 tool reports unmet gates; under `block`, it fails the check; under `off`,
it does neither. A bot's own commits never trigger a gate. <!-- @lore layers#DEC-6, layers#QRK-1 -->

## 10. Lint

| Code | Level | Rule |
|---|---|---|
| `L001` | error | Reference to a nonexistent node or claim |
| `L002` | error | Duplicate claim ID within a node |
| `L003` | error | Claim prefix doesn't match its section, or a claim inside an open section |
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
| `L022` | error | A claim in a public folder references a non-public node |
| `L023` | warn | `depends:` points at a retired or superseded claim |

Codes are never reused, like claim numbers. Retired in v0.3: `L005` (parent chain; the map replaces
it), `L007` (plans), `L009` (unanchored node), `L014` (section order), `L020` (summary twice).

Tools MUST NOT report open sections, comments, unknown fields or unknown metadata keys.

## 11. Conformance levels

| Level | Adds | Requires |
|---|---|---|
| **L0** Format | §2–§4, §6 | Nothing |
| **L1** Markers | §5.1 | Nothing (grep) |
| **L2** CLI | Lint (§10), tiers and staleness (§5), digests (§7) | A `lore` binary |
| **L3** CI | Selection and gates on every PR (§8.1, §9) | A CI action |
| **L4** Agent | Checks and self-evaluation (§8), proposed claim updates | A model |
| **L5** Push | A digest of the claims covering a file, injected when an agent opens it | An editor or agent hook |

An agent at any level MUST only edit nodes affected by its change, MUST NOT delete claims or others'
comments, and its changes go through normal review. Upgrading `lore:` is a human decision.
<!-- @lore layers#DEC-1 -->

## 12. Versioning

- `LORE.md` declares `lore: <major>.<minor>` (`L018`). Each version is tagged in this repository as `v<major>.<minor>`.
- **From 1.0**, a minor version only adds; a major version may change anything and ships migration notes. **Before 1.0**, any minor may break, with migration notes. <!-- @lore layers#DEC-3 -->
- Tools ignore what they don't know (fields, keys, sections, claim prefixes), and MUST read every minor version of the majors they support.

### 12.1 Reading earlier graphs

Tools MUST read v0.1 and v0.2 graphs:

- **Root:** `APP.md` when there's no `LORE.md`; `app` is an alias of `lore`; `.lore/config.json`'s `dir` acts as `nodes`.
- **Frontmatter:** `summary`, when present, is the node's lead, and the first paragraph is read as context (in v0.1 graphs the first paragraph was often a pointer to longer docs, not a summary); `parent` places a node in the tree when the map doesn't list it; `scope`, `links` and `status` are ignored.
- **Claim types:** `LIM`, `QRK` and `EDGE`, under `## Limits`, `## Quirks` and `## Edges`, are read as `NOTE` kind and keep their IDs; `PLAN` under `## Plans` is read as `NOTE` too. New claims use `NOTE`. Renumbering would break references, so migration never does it.
- **Markers:** `enforces` and `implements` are read as plain `@lore`.

### 12.2 Migrating to v0.3

Set `lore: 0.3`; add a `## Map` with every node nested where its `parent` said; delete `scope`,
`parent`, `links`, `status` and `summary` (moving any summary into the lead); drop the verbs from
markers. Keep every claim ID. A formatter MAY do all of it.

## 13. Open questions

- **False confirmation.** How often does an agent check agree with a claim that's no longer true? The loop's value depends on it; measure before trusting it.
- **Goodhart.** Will authors write claims that are easy to verify rather than important? Watch claim quality in review.
- **Comments' end state.** Should a comment older than a set age be flagged until it becomes a claim or is deleted?
- **Cross-repo references.** Public folders make a package's claims readable elsewhere; should another repository be able to reference them?
- **Extensions.** Should `LORE.md` be able to declare more claim kinds (a `RISK`, an `SLO`), as long as each says which existing kind it behaves as? Not until two trials ask for the same one.
- Marker regions: is 50 lines enough before tree-sitter adapters?

## 14. Changelog

### v0.3 (2026-10-16, draft)

From the GameRelay trial's review of v0.2, two variations compared (a minimal closed format, and a
core with profiles), and the properties they unlock. v0.3 takes the minimal one, plus the two
pieces of the other the goals need (`depends`, public folders), and leaves extensions open (§13).

- **Goals** (§1) and **the verification loop** (§8): select, ask, check, record. Agent checks refresh freshness, never tiers.
- **Three claim kinds**: `INV` (guardrail), `DEC` (prior), `NOTE` (context), with what an agent does with each. `LIM`, `QRK`, `EDGE` and `PLAN` are read as `NOTE`; plans move out of claims.
- **The map is the tree** (§2.1). `parent`, `scope`, `links` and node `status` are gone; the graph is derived from references, including commits and PRs (§6).
- **Frontmatter is `covers` and `verified`** (plus `lore`, `nodes`, `public`, `gate` on the root).
- **Markers**: `@lore <ref>` and `@lore see <ref>`; severity comes from the claim's kind, not the verb.
- **Only invariants have a trust tier**; `files:` anchors claims in files that can't hold a comment.
- **`depends:`** between claims, with one-hop staleness (§5.3).
- **Digests** at depths 0–3 (§7), required at L2.
- **Gates** (§9) with `Lore-Ack:` and a `gate:` policy.
- **Public folders** (§2.2): self-contained, breaking-change aware.
- **`Lore-Verified:` trailers** give claim-level verification without tool state in the docs.
- Lint: added `L021`–`L023`; retired `L005`, `L007`, `L009`, `L014`, `L020`; codes never reused.

### v0.2 (2026-10-16)

`LORE.md` entry point with node-folder routing; protocol versioning; open sections and comments;
the summary as the lead paragraph; frontmatter as a YAML subset; narrow `covers`; lint
`L015`–`L020`. From the GameRelay trial (asleepace/gamerelay.io#225).

### v0.1 (2026-10-15)

`verified` dates via `git blame`; markers in markdown; tierless decisions; `Rejected:` lines;
section order as a recommendation; optional `date`.
