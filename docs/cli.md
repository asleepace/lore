---
covers: [cli/src/**, cli/package.json, action.yml]
verified: 2026-10-16
---

# CLI

`lore`, the L2 to L4 tools: small commands that each do one step of the verification loop and compose through JSON, for people and agents alike, also served as MCP tools and run as a GitHub Action.

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

### DEC-6
`check` hands each claim's prompt to any command on stdin (`--agent`, or `$LORE_AGENT`) and reads a `VERDICT: holds|broken|unsure` line; without one, it prints the prompts.

The prompt holds the claim, its question and the code that upholds it, with line numbers, so the model needs nothing else; an agent with file access can read further, which is how a check caught a break the shown code didn't contain ([freshness#NOTE-2](freshness.md#note-2)). Any command works (`claude -p`, a script, a local model), so the CLI stays free of model clients. An unclear or missing verdict counts as `unsure`, never as `holds`. Without an agent the prompts are the output, for an agent that is itself the model.
Rejected: a built-in model client, which is a dependency, an API key to manage and one vendor. Rejected: a free-form answer parsed for meaning, which turns the verdict into a guess.

- depends: freshness#NOTE-1

### DEC-7
`lore mcp` serves the same functions as MCP tools over stdio, hand-written JSON-RPC with no SDK, and its check tool returns prompts rather than calling a model.

An agent connected to the server can run the whole loop itself: read a digest before editing, select what its change reaches, prepare the checks, answer them, and get the trailer to add. The calling agent is already a model, so a server that called another one would pay twice and hide the reasoning. The protocol needs four methods; an SDK would be the CLI's only dependency (INV-2).
Rejected: the MCP SDK. Rejected: a check tool that calls a model from inside the server.

### DEC-8
The GitHub Action runs `lint`, `select` and `gate` on pull requests and writes them to the job summary; the PR description reaches the script through an environment variable.

It needs only `contents: read`, so it runs safely on pull requests from forks. Interpolating `${{ github.event.pull_request.body }}` into a script would let a PR description run commands in CI. The `check` step isn't in the Action yet: it needs a model and a secret, which each repository should opt into.
Rejected: posting PR comments, which needs a write token, for a first version.

## Notes

### NOTE-1
The check step of the loop isn't a command yet: an agent runs `select`, `ask`, answers the questions itself, then `record`.

- depends: layers#DEC-4
- status: retired

> **agent (Claude), 2026-10-16:** Retired: `lore check` and the MCP check tool do this now (DEC-6, DEC-7).

### NOTE-2
A trailer anywhere in a range satisfies a gate for the whole range, so a `Lore-Ack:` in the first commit of a PR covers changes in its last.

### NOTE-3
`history` reads git only; PR descriptions and issues that mention a claim aren't seen yet.

### NOTE-4
The first real checks agreed with the code every time: 5 of 5 on GameRelay, including a break outside the code the prompt showed.

Three invariants on clean code held; an obvious break and a subtle one were both reported broken, with the right lines (Claude through `claude -p --tools Read,Glob,Grep`, about 20 seconds a claim). A sweep of this repository's 12 invariants then found one real break nobody had seen (`lint` read today's date, breaking INV-3; fixed with `--today`) and answered "unsure" where enforcement really is partial ([format#INV-2](format.md#inv-2)). Seventeen checks are still too few to trust the loop; they say the method works and that the agent doesn't simply agree, not how often it's wrong.

- depends: freshness#NOTE-1

## Pipelines

```sh
lore digest --depth 1                                # orient: the map and every node's lead
lore digest --depth 2 --files src/room/Room.ts       # the claims around a file, before editing it
lore select main..HEAD --json | lore ask - --json    # what this branch might break, as questions
lore check main..HEAD --agent "claude -p"            # check what it reaches with a model; exit 1 if broken
lore check main..HEAD --json --agent "$AGENT" | lore record verified -   # trailers for what holds
lore check --sweep --agent "$AGENT"                  # every invariant, whatever changed
lore gate main..HEAD --message pr.md                 # are reached invariants updated, acked or verified?
lore record verified room#INV-2                      # the trailer to add once a check agrees
lore history room#INV-2                              # every commit that touched a guarantee
```

## Agents

`lore mcp` serves `lore_digest`, `lore_select`, `lore_check_context`, `lore_ask`, `lore_gate`,
`lore_record`, `lore_history` and `lore_lint`. Its instructions tell a connected agent the loop:
read the digest before changing code, select what the change reaches, check it, add the trailer.

```json
{ "mcpServers": { "lore": { "command": "bun", "args": ["/path/to/lore/cli/src/bin.ts", "-C", ".", "mcp"] } } }
```

## Next

- A false-confirmation benchmark: break claims on purpose across a real repository and count how often a check still says "holds" (freshness#NOTE-1 is the risk; NOTE-4 is five data points).
- An opt-in `check` step in the Action, with the model command and its secret supplied by the repository.
- `history` over PR descriptions and issues.
- A root `ignore:` list for fixtures and generated code (see the inbox).
