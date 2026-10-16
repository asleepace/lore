# lore (CLI)

Small tools over a [Lore](../SPEC.md) graph, one step of the verification loop each. Text for
people, `--json` for agents, `-` to read claims from stdin, so they compose. `-C <dir>` works like
`git -C`: relative paths (a cases file, `--message`) are read from that directory. No runtime
dependencies. Design notes: [docs/cli.md](../docs/cli.md).

```sh
cd cli && bun install
bun src/bin.ts -C .. lint             # or: bun run build && node dist/lore.js -C .. lint
```

| Command | Does | Exit |
|---|---|---|
| `review [range\|--staged] [--agent cmd] [--max 50] [--selected]` | What a change could break: reached claims, what rests on them, a verdict on every invariant (up to `--max`) | 1 if any broken |
| `lint` | Check the graph against the spec; counts kinds and invariant tiers | 1 on errors |
| `digest [--depth 0-3] [--node id] [--files f…]` | The graph at a depth, or just the part around some files | 0 |
| `select [range\|--staged] [--no-covers]` | Claims a change might break, with severity and reasons | 0 |
| `ask <ref>…\|-` | The question each claim poses | 0 |
| `check [range\|ref…\|-] [--agent cmd] [--jobs n] [--sweep]` | Check claims against the code with any model command; without one, print the prompts | 1 if any broken |
| `gate [range] [--message pr.md] [--policy …]` | Are reached invariants updated, acknowledged or verified? | 1 if unmet under `block` |
| `history <ref>` | Commits whose message or diff mentions a claim | 0 |
| `record verified\|ack <ref>…` | The trailer line to add to a commit or PR | 0 |
| `show <ref\|node>…` | One claim with its code and every edge, or a node with its claims, without reading the file | 0 |
| `trace <ref\|node\|path>…\|- [--up\|--both] [--depth n]` | What rests on a claim, node or file, hop by hop, as a table | 0 |
| `find [word…] [--kind] [--node] [--file] [--tier]` | Claims matching every filter, as records the other commands take | 0 |
| `bench <cases.json> [--agent cmd] [--jobs n]` | Break claims on purpose in throwaway worktrees; score selection (recall and noise) and checks | 1 on a false confirmation |
| `link <ref> [--from file]` | The markdown link for a reference | 0 |
| `graph` | The whole graph as JSON | 0 |
| `mcp` | Serve these as MCP tools over stdio | runs until stdin closes |

Usage errors exit 2. `--today YYYY-MM-DD` (or `$LORE_TODAY`) sets the date `review_after` is compared with, so lint is a function of its input. A range is anything `git diff` takes (`main..HEAD`); with a single revision
the work tree is compared with it, and with none, the work tree with the index.

## Planning

```sh
lore digest --depth 1                # the whole repository's map in a few hundred words
lore trace src/room/Room.ts          # the claims anchored in a file, and what rests on them
lore show room#INV-2                 # one claim in full, with its code and every edge
```

## Reviewing

```sh
lore review main..HEAD --agent "claude -p --tools Read,Glob,Grep"
```

```
## Lore review: main..HEAD

The change reaches 1 claim; every invariant is checked (21, few enough to afford).

### ✗ broken: room#INV-3 (INV, high)

State patches can't use the keys `__proto__`, `constructor` or `prototype`.

- **Reached:** changed UNSAFE_KEYS (apps/server/src/room/Room.ts:56), used by the marker at 543
- **Rests on it:** room#INV-2 (same code as room#INV-3: apps/server/src/room/Room.ts:543)

> `UNSAFE_KEYS` no longer lists `'__proto__'` (Room.ts:57), so a patch with that key passes …

### Not reached by the change: 20 of 20 invariants hold
```

Decisions and notes the change reaches are listed as context, not checked. Without `--agent`,
`review` prints the context and questions, for an agent that is itself the model.

## The loop, one step at a time

```sh
lore select main..HEAD --json | lore ask - --json          # 1–2: what this change reaches, as questions
lore check main..HEAD --agent "claude -p --tools Read,Glob,Grep" --json \
  | lore record verified -                                 # 3–4: check with a model; trailers for what holds
lore gate main..HEAD                                       # anything reached and not handled?
lore check --sweep --agent "$AGENT"                        # every invariant, whatever changed
```

`--agent` is any command that reads a prompt on stdin and prints an answer starting with
`VERDICT: holds`, `VERDICT: broken` or `VERDICT: unsure`. Without it, `check` prints the prompts.

## Navigating

The graph's edges are derived, never declared: `depends:`, references in a claim's text,
`superseded_by`, and claims whose code is the same block (marker regions that touch, in code, not
in markdown).

```sh
lore show room#INV-2                 # the claim, where its code is, and every edge, in a few lines
lore trace room#INV-2                # what rests on it (downstream): what a change to it can break
lore trace room#INV-2 --up           # what it rests on
lore trace src/room/Room.ts          # every claim anchored in a file, and what rests on them
lore find --kind INV --tier asserted # invariants no code anchors
lore find host --node room --json | lore check - --agent "$AGENT"
```

```
| Hop | Claim | Relation | Statement |
|---|---|---|---|
| 0 | freshness#INV-1 | start | Detecting staleness never requires an LLM. |
| 1 | cli#INV-3 | depends on freshness#INV-1 | `select`, `lint`, `digest` and `gate` never call a model … |
| 1 | freshness#DEC-7 | same code as freshness#INV-1: cli/src/select.ts:81 | A claim may list what it `depends:` on … |
| 2 | cli#NOTE-4 | mentions cli#INV-3 | The first real checks agreed with the code every time … |
```

## Measuring: bench

A cases file lists edits that break a claim, or leave it intact, with the expected answer:

```json
{ "hide": ["lore/_inbox.md"],
  "cases": [{ "id": "replay", "ref": "protocol#INV-3", "expect": "broken",
              "edits": [{ "file": "apps/server/src/server.ts", "find": "signed.seq <= ws", "replace": "signed.seq < ws" }] }] }
```

`lore bench cases.json --agent "$AGENT"` applies each case in its own worktree, records whether
selection reached the claim and what the check said, and reports false confirmations ("holds" on
a broken claim), false alarms, unsure answers, and selection noise (other claims each edit reached,
since recall alone would reward selecting everything). The cases file and `hide` paths are deleted from
each worktree first, so the agent can't read the answers. Without an agent it scores selection only.

## For agents: MCP

```json
{ "mcpServers": { "lore": { "command": "bun", "args": ["/path/to/lore/cli/src/bin.ts", "-C", ".", "mcp"] } } }
```

Tools: `lore_digest`, `lore_review` (a change's review context), `lore_select`, `lore_check_context` (prompts for the agent to answer itself),
`lore_show`, `lore_trace`, `lore_find`, `lore_ask`, `lore_gate`, `lore_record`, `lore_history`, `lore_lint`.

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
