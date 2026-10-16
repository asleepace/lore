# lore (CLI)

Small tools over a [Lore](../SPEC.md) graph, one step of the verification loop each. Text for
people, `--json` for agents, `-` to read claims from stdin, so they compose. No runtime
dependencies. Design notes: [docs/cli.md](../docs/cli.md).

```sh
cd cli && bun install
bun src/bin.ts -C .. lint             # or: bun run build && node dist/lore.js -C .. lint
```

| Command | Does | Exit |
|---|---|---|
| `lint` | Check the graph against the spec; counts kinds and invariant tiers | 1 on errors |
| `digest [--depth 0-3] [--node id] [--files f…]` | The graph at a depth, or just the part around some files | 0 |
| `select [range\|--staged] [--no-covers]` | Claims a change might break, with severity and reasons | 0 |
| `ask <ref>…\|-` | The question each claim poses | 0 |
| `check [range\|ref…\|-] [--agent cmd] [--sweep]` | Check claims against the code with any model command; without one, print the prompts | 1 if any broken |
| `gate [range] [--message pr.md] [--policy …]` | Are reached invariants updated, acknowledged or verified? | 1 if unmet under `block` |
| `history <ref>` | Commits whose message or diff mentions a claim | 0 |
| `record verified\|ack <ref>…` | The trailer line to add to a commit or PR | 0 |
| `link <ref> [--from file]` | The markdown link for a reference | 0 |
| `graph` | The whole graph as JSON | 0 |
| `mcp` | Serve these as MCP tools over stdio | runs until stdin closes |

Usage errors exit 2. `--today YYYY-MM-DD` (or `$LORE_TODAY`) sets the date `review_after` is compared with, so lint is a function of its input. A range is anything `git diff` takes (`main..HEAD`); with a single revision
the work tree is compared with it, and with none, the work tree with the index.

## The loop

```sh
lore select main..HEAD --json | lore ask - --json          # 1–2: what this change reaches, as questions
lore check main..HEAD --agent "claude -p --tools Read,Glob,Grep" --json \
  | lore record verified -                                 # 3–4: check with a model; trailers for what holds
lore gate main..HEAD                                       # anything reached and not handled?
lore check --sweep --agent "$AGENT"                        # every invariant, whatever changed
```

`--agent` is any command that reads a prompt on stdin and prints an answer starting with
`VERDICT: holds`, `VERDICT: broken` or `VERDICT: unsure`. Without it, `check` prints the prompts.

## For agents: MCP

```json
{ "mcpServers": { "lore": { "command": "bun", "args": ["/path/to/lore/cli/src/bin.ts", "-C", ".", "mcp"] } } }
```

Tools: `lore_digest`, `lore_select`, `lore_check_context` (prompts for the agent to answer itself),
`lore_ask`, `lore_gate`, `lore_record`, `lore_history`, `lore_lint`.

## In CI: the GitHub Action

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: asleepace/lore@master
  with: { policy: warn }   # or block
```

It lints, lists the claims the PR reaches, checks gates against the PR description and commit
trailers, and writes it all to the job summary. Read-only (`contents: read`); the PR description
goes through an environment variable, never into the script.

## Tests

`bun test` builds throwaway git repositories and runs every command against them. Fixture markers
are assembled from pieces (`AT`), so this repository's own `lore lint` doesn't read them as anchors.
