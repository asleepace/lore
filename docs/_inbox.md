# Inbox

Unsorted findings waiting to be triaged into claims or spec changes. Not a node (see `SPEC.md` §9).

## From dogfooding v0 (2026-10-15)

Written while documenting Lore with Lore: 5 nodes, 35 claims, checked with a throwaway v0 linter.

### Spec changes

- **[freshness] Every node is born stale.** `verified_at` can't name the commit that sets it (freshness#QRK-1). Worse, this same commit also edits `SPEC.md`, so by §8 all five nodes covering it are stale the moment they land. **Proposal:** replace `verified_at: <sha>` with `verified: <date>`. The verification commit is whichever commit last touched that line, which `git blame` gives for free. That kills QRK-1 and keeps a human-meaningful value in frontmatter.

- **[markers] Example markers in fenced code blocks are false positives.** A naive scan found 4 broken references in `SPEC.md` and `README.md`, all from examples (markers#QRK-2). **Proposal:** spec rule: markers inside fenced code blocks in markdown files are ignored.

- **[markers] Markers work in markdown via inline HTML comments, and that's useful.** All 8 invariants here are anchored to the `SPEC.md` lines that uphold them. **Proposal:** promote markers#QRK-1 into the spec, and allow a marker at the end of the line it anchors, not just above it.

- **[format] The fixed section order fought natural writing.** I broke it in 3 of 4 nodes by writing Quirks before Limits. The order gives an agent nothing. **Proposal:** make order a SHOULD, enforced by a formatter (`lore fmt`) rather than as a lint error.

- **[freshness] Trust tiers misread decisions.** 27 of 35 claims are "asserted", but 16 of those are decisions and plans, which nothing can ever enforce. The meaningful number is invariants: 8 of 8 anchored. **Proposal:** tiers apply to INV, EDGE, LIM and QRK; reports exclude DEC and PLAN.

- **[freshness] `covers: [SPEC.md]` is too coarse to be useful.** Any spec edit flags all 5 nodes at low severity, which trains people to ignore it. **Proposal:** allow heading-scoped covers for markdown (`SPEC.md#5-markers`). When a claim has markers, treat covers-only staleness as informational.

- **[format] "Rejected:" lines appeared unprompted in 7 decisions.** They're arguably the most valuable line in a decision for an agent, because they stop it from re-proposing ideas already ruled out. **Proposal:** formalize a `Rejected:` line as a convention for DEC claims.

- **[format] `- date:` on every decision is noise.** It added 13 lines that git already knows. **Proposal:** make it optional, only for decisions recorded after the fact.

- **[format] Root-to-node links break the "ID minus extension" rule** (format#QRK-2). **Options:** (a) accept two link forms and let a formatter fix paths; (b) move the root to `docs/app.md` and keep `APP.md` as a one-line pointer. Leaning (a).

- **[format] The inbox itself has no defined format.** This file improvised one. **Proposal:** bullets of `**[target-node]** finding. **Proposal:** …`, grouped by source.

### Observations for adopters

- **Documenting prose duplicates it.** Here the spec is the "code", so invariants restate its MUST rules (~320 lines of docs for a 267-line spec). In a code repo invariants aren't duplicated, because code doesn't state them. The value here came from decisions and quirks, which `SPEC.md` doesn't hold.
- **Anchoring is cheap and pays off immediately.** Adding 7 inline markers took one minute and turned every invariant into a checked one.
