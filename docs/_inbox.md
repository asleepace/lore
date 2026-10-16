# Inbox

Unsorted findings waiting to be triaged into claims or spec changes. Not a node (see `SPEC.md` §9).

## First real checks (2026-10-16)

`lore check` with Claude (`claude -p --tools Read,Glob,Grep`):

- **GameRelay, 5 of 5 right.** Three invariants held on clean code; an obvious break was reported
  broken; a subtle one (`'__proto__'` removed from `UNSAFE_KEYS`, ~500 lines from the marked
  check) was reported broken when asked, though **selection reached nothing**. Selection, not the
  model, is the weak link: freshness#NOTE-2, the sweep, and a marker on the definition (pushed to
  asleepace/gamerelay.io#225).
- **This repo's sweep found a real break.** `lint` compared `review_after` with today's date, so
  cli#INV-3 ("same output for the same input") didn't hold; the back-to-back test couldn't see it.
  Fixed: the date is an input (`--today`, `$LORE_TODAY`).
- **"Unsure" when it should be.** format#INV-2 (numbers never reused) is a rule about authors that
  code only partly enforces; the check said so instead of agreeing. Gates now refuse deleted claim
  headings; reuse is still only fully preventable with history.
- **The spec said asking needs a model.** It doesn't: questions are templates (cli#DEC-5). Fixed in
  `SPEC.md` §8 and layers#DEC-4, found while wiring `check`.

## Building the CLI (2026-10-16)

- **[markers] Test fixtures hold example markers.** The CLI's own tests write markers into
  throwaway repos, and `lore lint` on this repo read them as real anchors (17 errors). Fixed by
  assembling them from pieces. Every tool that tests Lore will hit this. **Proposal:** a root
  `ignore:` list of globs where markers aren't read, for fixtures, vendored and generated code;
  not added yet, since the workaround is one line.
- **[layers] Adding a test that anchors an invariant fires its gate.** On this branch, new tests
  with markers reached format#INV-3, freshness#INV-1 and markers#INV-1, so the gate asked for an
  acknowledgment for anchoring work. Arguably right (an anchor is a claim about code someone should
  check), arguably noise. **Proposal:** watch it; if it's noise, a marker added on a `+` line could
  count as `medium` rather than reaching the gate.
- **[format] Versions must stay strings.** `lore: 0.10` read as a number is `0.1`. The CLI's parser
  only turns integers into numbers; the spec's subset should say versions are strings.
- **[freshness] The map gives reading order.** A first digest sorted nodes by ID; DEC-13 says the
  map is the reading order, so digests follow it.

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
