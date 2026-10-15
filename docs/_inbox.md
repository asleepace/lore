# Inbox

Unsorted findings waiting to be triaged into claims or spec changes. Not a node (see `SPEC.md` §9).

## From dogfooding v0 (2026-10-15)

Triaged into v0.1: `verified` dates via blame, markdown markers, tierless decisions, `Rejected:` lines, optional section order and `date`. See `SPEC.md` §13. Still open:

- **[freshness] `covers: [SPEC.md]` is too coarse to be useful.** Any spec edit flags all 5 nodes at low severity, which trains people to ignore it. **Proposal:** allow heading-scoped covers for markdown (`SPEC.md#5-markers`). When a claim has markers, treat covers-only staleness as informational.

- **[format] Root-to-node links break the "ID minus extension" rule** (format#QRK-2). **Options:** (a) accept two link forms and let a formatter fix paths; (b) move the root to `docs/app.md` and keep `APP.md` as a one-line pointer. Leaning (a).

- **[format] The inbox itself has no defined format.** This file improvised one. **Proposal:** bullets of `**[target-node]** finding. **Proposal:** …`, grouped by source.

### Observations for adopters

- **Documenting prose duplicates it.** Here the spec is the "code", so invariants restate its MUST rules. In a code repo invariants aren't duplicated, because code doesn't state them. The value here came from decisions and quirks, which `SPEC.md` doesn't hold.
- **Anchoring is cheap and pays off immediately.** Adding inline markers took a minute and turned every invariant into a checked one.
