# Inbox

Unsorted findings waiting to be triaged into claims or spec changes. Not a node (see `SPEC.md` §9).

## v0.3 tool run (2026-10-16)

A throwaway v0.3 tool (lint, digest, select) run on both graphs:

- **[format] v0.1 leads were context, not summaries.** In GameRelay's v0.1 nodes the first paragraph
  was often "Long form: PLAN.md…", because the summary lived in frontmatter, so depth-1 digests
  read badly. Fixed in `SPEC.md` §12.1: a legacy `summary` wins over the first paragraph.
- **[freshness] Digests are small.** GameRelay renders at 27, 261, about 1,490 and about 2,890
  words for depths 0–3: the whole repository's map in a few hundred tokens.
- **[freshness] Selection is precise once regions stop at blank lines.** Loosening the host-only
  state check in `Room.ts` selects exactly one high-severity claim (room#INV-2); a first version
  of the tool that ignored region ends also flagged the neighbouring room#INV-4.
- **[layers] Still unmeasured:** false confirmations in the check step (freshness#NOTE-1).

## From the GameRelay trial (2026-10-16)

A first slice of Lore on asleepace/gamerelay.io (PR #225): 10 nodes, 68 claims, 26 markers in 11
files, on a monorepo whose `docs/` already held narrative docs. Checked with a throwaway lint script.

Triaged into v0.2 (`SPEC.md` §14): `LORE.md` as entry point with `nodes:` routing (format#DEC-8),
versioning (layers#DEC-3), open sections (format#DEC-9), comments (format#DEC-10), summaries as lead paragraphs (format#DEC-11)
with a YAML subset and `L015`, narrow `covers` guidance, `Rejected:` on its own line. Still open:

- **[freshness] Most "asserted" claims couldn't be anchored.** Triaged into v0.3: only invariants
  have a tier (freshness#DEC-8) and `files:` anchors claims in files that can't hold a comment
  (freshness#DEC-6). Read with the v0.3 tool, GameRelay's graph goes from 15 asserted of 37 tiered
  claims to 5 of 21 invariants, and each of those 5 is a real gap.
- **[markers] Markers in published packages point into a private graph.** Triaged into v0.3:
  public node folders (lore#DEC-3).
- **[tooling] Ship L2 lint first.** The trial's 200-line checker caught the YAML errors and
  misplaced `Rejected:` lines; nobody keeps 68 claims valid by eye. Matches layers#PLAN-1.
- **[process] Narrative docs and nodes overlap.** GameRelay keeps decisions as dated prose in
  PLAN.md and HISTORY.md; nodes distil them into claims, and two sources drift. **Proposal:**
  adoption guidance: decisions move into nodes, narrative docs link to claims.
- **[value] Writing claims finds bugs.** The trial's best output was a real inconsistency (a state
  limit counted in UTF-16 units while every other limit counts bytes), found because a claim had to
  say exactly what the limit counts. Worth saying in the README: the first pass is a code review.

## From dogfooding v0 (2026-10-15)

Triaged into v0.1: `verified` dates via blame, markdown markers, tierless decisions, `Rejected:` lines, optional section order and `date`. See `SPEC.md` §14. Triaged into v0.2: the inbox format (§9) and root-to-node links (paths relative to the file, format#QRK-2). Still open:

- **[freshness] `covers: [SPEC.md]` is too coarse to be useful.** Any spec edit flags all 5 nodes at low severity, which trains people to ignore it. **Proposal:** allow heading-scoped covers for markdown (`SPEC.md#5-markers`). When a claim has markers, treat covers-only staleness as informational. The GameRelay trial saw the same with a large source file (`SPEC.md` §8 now advises narrow covers).

### Observations for adopters

- **Documenting prose duplicates it.** Here the spec is the "code", so invariants restate its MUST rules. In a code repo invariants aren't duplicated, because code doesn't state them. The value here came from decisions and quirks, which `SPEC.md` doesn't hold.
- **Anchoring is cheap and pays off immediately.** Adding inline markers took a minute and turned every invariant into a checked one.
