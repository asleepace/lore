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
| `gate [range] [--message pr.md] [--policy …]` | Are reached invariants updated, acknowledged or verified? | 1 if unmet under `block` |
| `history <ref>` | Commits whose message or diff mentions a claim | 0 |
| `record verified\|ack <ref>…` | The trailer line to add to a commit or PR | 0 |
| `link <ref> [--from file]` | The markdown link for a reference | 0 |
| `graph` | The whole graph as JSON | 0 |

Usage errors exit 2. A range is anything `git diff` takes (`main..HEAD`); with a single revision
the work tree is compared with it, and with none, the work tree with the index.

## The loop, by hand or by an agent

```sh
lore select main..HEAD --json | lore ask - --json   # 1–2: what this change reaches, as questions
# 3: answer each question from the new code (an agent, or you)
lore record verified room#INV-2                     # 4: agreed → add the trailer it prints
lore gate main..HEAD                                # anything reached and not handled?
```

## Tests

`bun test` builds throwaway git repositories and runs every command against them. Fixture markers
are assembled from pieces (`AT`), so this repository's own `lore lint` doesn't read them as anchors.
