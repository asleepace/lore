---
scope: domain
parent: app
summary: Why claims are anchored by marker comments in the files that uphold them.
covers: [SPEC.md]
links:
  - { to: freshness, rel: related, note: "marker regions are the main staleness signal" }
verified: 2026-10-15
review_after: 90d
---

# Markers

## Invariants

### INV-1
A marker always uses a full reference (`node#TYPE-n`).

A code file has no owning node, so a local reference like `INV-1` would be ambiguous.

## Decisions

### DEC-1
Files point at claims, rather than claims pointing at files.

A marker comment moves with its code through renames and refactors, works in any language with comments, and is findable with plain grep. Claims pointing at file paths and line numbers would break on every move.
Rejected: AST-based symbol anchors as the baseline. They're more precise but language-specific; they become an optional adapter instead (PLAN-1).

### DEC-2
A marker's verb sets how strongly a change near it affects the claim.

`enforces` means this code makes the claim true, `implements` means it carries the claim out, and `see` is informational and never flags anything. Three verbs keep the grammar small enough to remember.
Rejected: a single verb, which can't tell code that makes a claim true from code that merely mentions it.

### DEC-3
In markdown, only markers inside HTML comments count, and never inside fenced code or inline code.

Markdown files can uphold claims (this repo anchors every invariant in `SPEC.md`), but they also show markers as examples. Requiring an HTML comment outside code separates the two with one rule.
Rejected: skipping fenced blocks only, which still miscounted an example in inline code (`<!-- … -->` in backticks) as a real anchor.

## Limits

### LIM-1
A marker's region is a heuristic: from its line to the next blank line or marker, capped at 50 lines.

This over-covers dense code and under-covers long functions with blank lines inside them.

## Quirks

### QRK-1
Markers work in any file that has comments, including markdown.

An inline HTML comment (`<!-- @lore enforces format#INV-1 -->`) is invisible when rendered. This repo uses that to anchor claims to the `SPEC.md` rules that uphold them.

- status: superseded
- superseded_by: markers#DEC-3

### QRK-2
Example markers inside fenced code blocks look exactly like real markers.

`SPEC.md` and `README.md` show markers pointing at a sample `moderation` node that doesn't exist. A grep-based scanner reads these as broken references unless it skips fenced code blocks in markdown.

- status: superseded
- superseded_by: markers#DEC-3

## Plans

### PLAN-1
Add a tree-sitter adapter that narrows a marker's region to its enclosing symbol.

- review_after: 2027-04-15
