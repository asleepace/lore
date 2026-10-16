# Inbox

Unsorted findings waiting to be triaged into claims or spec changes. Not a node (see `SPEC.md` §9).
Triaged findings leave; git keeps them ([lore#DEC-7](../LORE.md#dec-7)).

## Triaged into v0.4 (2026-10-16)

From the GameRelay benchmark and a review of v0.3 against what the trials used:
purpose and ranked intentions (lore#DEC-6), history from git (lore#DEC-7), extensions
(lore#DEC-8), derive, don't declare (lore#DEC-9), reviews check every invariant when small
(layers#DEC-7, cli#DEC-11), trust is measured (freshness#DEC-10), decision checks wait for a
benchmark (freshness#DEC-11), invariants state guarantees (format#DEC-15), no shared code in
markdown (cli#DEC-9), versions are strings (`SPEC.md` §3.1). The benchmark's numbers are in
cli#NOTE-5.

## Still open

- **[markers] Test fixtures hold example markers.** The CLI's tests write markers into throwaway
  repos, and `lore lint` read them as real anchors (17 errors), fixed by assembling them from
  pieces. Every tool that tests Lore will hit this. Now an open question in `SPEC.md` §15: a root
  `ignore:` list, or nothing until a second repository needs it.
- **[layers] Adding a test that anchors an invariant fires its gate.** New tests with markers
  reached format#INV-3, freshness#INV-1 and markers#INV-1, asking for an acknowledgment for
  anchoring work. **Proposal:** watch it; if it's noise, a marker added on a `+` line could count
  as `medium` rather than reaching the gate.
- **[layers] A benchmark's agent can read any path,** including the real checkout and its cases
  file. No answer did, but `bench` can only hide files inside its worktree. **Proposal:** document
  running the agent sandboxed to the worktree when the numbers matter.
- **[freshness] `covers: [SPEC.md]` is too coarse.** Any spec edit flags every node at low
  severity, which trains people to ignore it. **Proposal:** heading-scoped covers for markdown
  (`SPEC.md#5-anchors`), or covers-only staleness as informational when a claim has markers.
- **[process] Narrative docs and nodes overlap.** GameRelay keeps decisions as dated prose in
  PLAN.md and HISTORY.md; nodes distil them, and two sources drift. **Proposal:** adoption
  guidance: decisions move into nodes, narrative docs link to claims.
- **[value] Writing claims finds bugs.** GameRelay's first pass found a state limit counted in
  UTF-16 units while every other limit counts bytes, because a claim had to say exactly what the
  limit counts. Worth saying in the README: the first pass is a code review.

## Observations for adopters

- **Documenting prose duplicates it.** Here the spec is the "code", so invariants restate its MUST
  rules. In a code repository they don't, because code doesn't state them. The value here came
  from decisions and notes.
- **Anchoring is cheap and pays off immediately.** Adding inline markers took a minute and turned
  every invariant into a checked one.
