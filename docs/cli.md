---
covers: [cli/src/**, cli/package.json]
verified: 2026-10-16
---

# CLI

`lore`, the L2 and L3 tools: small commands that each do one step of the verification loop and compose through JSON, for people and agents alike.

## Invariants

### INV-1
Every command prints JSON with `--json`, and commands that take claims read them from stdin when given `-`.

That is what lets `select`, `ask`, `gate` and `record` be chained in a shell, a CI job or an agent's tool calls without any of them knowing about the others.

- tests: cli/test/loop.test.ts

### INV-2
The CLI has no runtime dependencies.

Agents install it in throwaway sandboxes and CI runners; every dependency is something to fetch, pin and break. The frontmatter parser is the CLI's own for the same reason (DEC-3).

- files: cli/package.json

### INV-3
`select`, `lint`, `digest` and `gate` never call a model and give the same output for the same input.

These run on every change, so they must be free and deterministic; the model step stays outside them.

- tests: cli/test/loop.test.ts
- depends: freshness#INV-1

## Decisions

### DEC-1
The CLI is many small commands, each one step of the loop, rather than one command that does everything.

Each command is a tool an agent can call on its own (select what a change reaches, ask what a claim poses, record what was verified), and a CI job or an agent strings them together. Chained on every change, they are how the graph keeps itself current, which is what makes it a living thing rather than a document someone has to remember. The same functions can later be served as MCP tools without changing what they do.
Rejected: one `lore check` that runs the whole loop, which hides the steps an agent needs to interleave with its own work. Rejected: a long-running daemon, which is state to manage for something git already stores.

### DEC-2
Text for people by default, JSON with `--json`, and three exit codes: 0 ok, 1 the check failed, 2 usage error.

People read the default output; agents and scripts need a shape they can parse and an exit code they can branch on. Keeping exit codes to three makes them safe to use in CI without reading docs.
Rejected: JSON by default, which makes the common human case worse. Rejected: per-rule exit codes, which nobody branches on.

### DEC-3
The frontmatter subset is parsed by the CLI's own small parser, not a YAML library.

[format#DEC-11](format.md#dec-11) defined a subset so a tool could say exactly what's wrong: "a plain value can't contain ': '" instead of "mapping values are not allowed here". A library can't give that error, and it would be the CLI's only dependency (INV-2). Anything a library reads that the subset doesn't is reported, not guessed at.
Rejected: a full YAML library.

### DEC-4
Written in TypeScript, run with Bun in development and tests, and built to one file that runs on Node.

[layers#PLAN-1](layers.md#plan-1) chose TypeScript first. Bun runs the sources and tests directly; Node is what most CI runners and agent sandboxes already have, so the built file targets it.
Rejected: Bun-only, which strands Node environments. Rejected: Rust or Go first, which slows the iteration a draft spec needs.

### DEC-5
`ask` builds each question from the claim's `ask:` or a fixed template per kind, and never calls a model.

The question is the contract of a check: the claim and the expected answer are fixed, and only the answer comes from a model. A template keeps L3 model-free ([layers#DEC-4](layers.md#dec-4)); an agent may rephrase the question but not change what it asks.
Rejected: model-written questions, which would make two runs of the loop ask different things.

## Notes

### NOTE-1
The check step of the loop isn't a command yet: an agent runs `select`, `ask`, answers the questions itself, then `record`.

- depends: layers#DEC-4

### NOTE-2
A trailer anywhere in a range satisfies a gate for the whole range, so a `Lore-Ack:` in the first commit of a PR covers changes in its last.

### NOTE-3
`history` reads git only; PR descriptions and issues that mention a claim aren't seen yet.

## Pipelines

```sh
lore digest --depth 1                                # orient: the map and every node's lead
lore digest --depth 2 --files src/room/Room.ts       # the claims around a file, before editing it
lore select main..HEAD --json | lore ask - --json    # what this branch might break, as questions
lore gate main..HEAD --message pr.md                 # are reached invariants updated, acked or verified?
lore record verified room#INV-2                      # the trailer to add once a check agrees
lore history room#INV-2                              # every commit that touched a guarantee
```

## Next

- A `check` command that hands each question and a digest to a model command (`--agent "claude -p"`) and records agreements, with mismatches left for review.
- An MCP server exposing the same commands as tools.
- A GitHub Action running `select` and `gate` on every PR.
- `history` over PR descriptions and issues.
