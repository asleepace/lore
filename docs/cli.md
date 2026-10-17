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

### INV-4
`lore bench` never changes the working tree: every case runs in a throwaway worktree that is removed afterwards.

A benchmark that edits the real tree to break claims would be one crash away from shipping the break.

- tests: cli/test/bench.test.ts

### INV-5
`record verified` never writes a trailer for a claim no check judged to hold.

A `Lore-Verified:` trailer satisfies a gate, so stamping unjudged claims would turn the gate off. Records piped from another command are verified only with a `holds` verdict (not `select` output, not `check` without an agent, not a review's unchecked decisions); refs a person types are taken as their word. Found by an independent review of this CLI.

- tests: cli/test/loop.test.ts

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

The prompt holds the claim, its question, the code that upholds it with line numbers, and the top-level definitions that code uses from elsewhere in its file (the constant a check compares with, the helper it calls), so the model needs nothing else; an agent with file access can read further, which is how a check caught a break the shown code didn't contain ([freshness#NOTE-2](freshness.md#note-2)). Any command works (`claude -p`, a script, a local model), so the CLI stays free of model clients. An unclear or missing verdict counts as `unsure`, never as `holds`. Without an agent the prompts are the output, for an agent that is itself the model.
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

### DEC-9
`show`, `trace` and `find` navigate the derived graph: `depends:`, references in a claim's text, `superseded_by`, and claims upheld by the same code. No edge is declared for them.

An agent that wants one claim, or what a change to it reaches, shouldn't have to read whole nodes to find out: `show` is one claim with its anchors and every edge, `trace` walks them breadth-first (downstream by default: what rests on the start, so what changing it can break), and `find` filters claims into records the other commands take. A file is a valid start, so "what rests on `Room.ts`" is one call. The edges are the ones the spec already derives ([format#DEC-13](format.md#dec-13)), so the graph gets more navigable as people write ordinary references, with nothing extra to keep in sync.
Rejected: a declared `chain:` or `affects:` list, which is a second copy of what references already say. Rejected: "same file" as shared code, which joined 1,080 pairs in this repository when it was tried; only regions that overlap or sit one line apart count, and only one hop from the start. Rejected: walking shared code transitively, which joins a large file into one blob. Rejected: shared code in markdown, where adjacent markers in prose (`SPEC.md`'s principles, one per line) joined 46 unrelated pairs.

### DEC-10
`lore bench` measures the loop with hand-written cases: exact edits that break a claim or leave it intact, each applied in a throwaway worktree, scoring selection and the check separately.

The risk the loop rests on is a check saying "holds" about a broken claim ([freshness#NOTE-1](freshness.md#note-1)), and the first trial showed a second one: selection not reaching the claim at all ([freshness#NOTE-2](freshness.md#note-2)). Scoring both says which stage to fix. Edits are find-and-replace strings that must match exactly once, so a case that no longer applies fails loudly instead of measuring nothing. The cases file and any path listed in `hide` are deleted from the worktree before the check, so the agent can't read the answers.
Rejected: generated mutations, which can't tell a break from a change that keeps the claim true, so every miss would need a person to judge it. Rejected: line-number patches, which go stale on the next commit.

- depends: freshness#NOTE-1

### DEC-11
`lore review <range>` is the review in one command: the claims a change reaches, what rests on them, and with an agent, verdicts about the change.

The pieces existed (`select`, `trace`, `check`), but a reviewing agent shouldn't have to compose three commands to answer one question. Selection marks the claims the change reached; triage flags the ones it could break elsewhere ([layers#DEC-8](layers.md#dec-8)); each is checked against the change ([DEC-13](#dec-13)). Without an agent it prints the review context, for an agent that is itself the model. Checks run in parallel (`--jobs`), so a review of tens of invariants takes about as long as the slowest one.
Rejected: a review that only checks selected claims, which caught 17 of 27 benchmark breaks against 27 of 27.

- depends: layers#DEC-8

### DEC-12
`lore infer` measures inferability in two steps: a blind answer from a claim's anchored code, in a worktree without the graph, then a graded comparison with the claim.

Asking a claim's own question without the graph hands the agent the claim; "yes, it holds" would measure verifiability, which the check already does. So the blind step gets only the location (the marked code, else `files:`, `tests:`, the node's `covers`, else its title) and a question for the claim's kind, in a worktree where `LORE.md`, the node folders and every marker are gone, with line numbers kept so snippets match. `--code-only` deletes all markdown too. A second call grades the answer against the full claim; for a decision, "inferred" needs the reason or what was rejected, not just the choice. Verdicts vary between runs (two GameRelay runs agreed on 53 of 68), so `--runs n` counts a claim as inferred only if every run infers it.
Rejected: the claim's own question without the graph, which leaks the answer. Rejected: string similarity between the answer and the claim, which can't tell a paraphrase from a different rule. Rejected: grading in the blind call, which lets the agent see the claim.

- depends: freshness#DEC-10

### DEC-13
A review's check gets the diff and judges the change: holds, broken by it, preexisting (broken before, not made worse) or unsure, by the guarantee the claim protects.

A check that asks "does this claim hold?" reads the claim's marked code, which a change adding a new path leaves intact: it said room#INV-4 holds while a new chat path let the host post as anyone. Given the diff and asked "does this change break it?", the same model caught it. `preexisting` separates a change's breaks from a claim's old problems: every false alarm in the A/B run was a claim that had been wrong before the change (sdk#INV-1's member list, protocol#INV-1's history). The prompt points at the rationale, since a claim's first sentence can state a mechanism while its rationale states the guarantee (format#DEC-15).
Rejected: the state check with the diff merely attached, which still frames the question as "is this true?"; the verdict has to be about the change.

- depends: format#DEC-15

### DEC-14
`lore bench --review` scores the whole review per case: recorded patches of feature work, each with a map of the invariants it breaks; every other invariant is expected to survive.

The one-claim bench asked "given this claim, is the break found?", which assumes something already pointed at the claim; a reviewer has no such pointer, and the A/B run's breaks were in code no marker covered. Scoring the full review counts what matters on a pull request: expected breaks caught or missed (and whether triage skipped them), false alarms across the whole graph, and model calls. Patches from real agent runs are feature-sized by construction. Hidden files are committed away before the case is applied, so the answers are never in the diff the review reads. A contested call is `either`.
Rejected: regenerating feature changes for each run, which costs an agent run per case and changes the case every time.

- depends: cli#DEC-10, freshness#DEC-10

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

### NOTE-5
On GameRelay's benchmark, the current prompt gave no false confirmations in 53 checks of broken claims, over two runs; the prompt before it gave 3 in 47.

The prompt that missed breaks trusted tests and names over code: `host.endsWith(base)` in `originAllowed` passed because a test said wildcards work, and `onLocalhost()` accepting `*.app` passed with "I did not read `onLocalhost()`, so I'm assuming…". Showing same-file definitions and asking for a line-by-line judgment (DEC-6) fixed both. The last full run caught 27 of 27 breaks, with 0 false alarms in 18 intact cases and no "unsure", in 131 seconds at six at a time. Selection reached 17 of the 27, and only 3 other claims across all 37 edits, so it is precise but misses callers, other files and unanchored invariants; checking every invariant catches those. A full `lore review` of GameRelay's 21 invariants takes about 80 seconds. Two caveats: the same model wrote the breaks and checked them, so these are breaks it can imagine; and on earlier runs two clean claims got "broken" for their wording (GameRelay's protocol#INV-1 and sdk#INV-1, now in its inbox), so false alarms vary from run to run.

- depends: freshness#NOTE-1, cli#DEC-10

### NOTE-6
On GameRelay, 8 of 68 claims were inferred from the code alone in both of two runs, and 34 were missed in both: those are what the graph adds.

The 8 are four invariants (still worth keeping as guardrails) and four decisions whose reason a code comment already states. The 34 are mostly notes and decisions about how parts meet, located only by their node's area: no single file says them. In the code-only run, pointed at exact code, an agent named about half the claims there unprompted (11 of 23); pointed at an area, 3 of 37. A missed claim isn't always unknowable: shown `Room`'s imports, the agent didn't think to say `Room` must import nothing but the protocol, which is the point; the graph says which of the true things matter. Each run took about four minutes, eight claims at a time.

On this repository (one run, `SPEC.md` left in place as the "code"), 8 of 13 invariants were inferred, since they restate the spec's MUST rules, but only 4 of 52 decisions, with 23 partial: the choice is visible in the spec, the reason and what was rejected live only here.

- depends: cli#DEC-12

### NOTE-7
Reviewing this CLI, an open-ended model review and `lore review` found different defects, and each finding that became an invariant is now checked on every review.

Two passes by a model that hadn't seen the code found 18 defects no claim covered, among them a git option injection through the MCP tools' range argument, `record verified` stamping claims nobody checked, and a diff parser that read `++i;` as a header. `lore review` found three the open-ended passes missed, each a stated guarantee: an unchecked edit path in `bench` (INV-4), markers for unknown prefixes raising errors (layers#INV-3), and titled headings slipping past the deletion gate (format#INV-2). The record bug became INV-5. Open-ended review finds what nobody wrote down; the graph keeps what was found from coming back.

- depends: cli#INV-5, cli#DEC-11

### NOTE-8
Reviews that read the change caught all 6 real breaks in the GameRelay A/B feature work; checking invariants against their marked code caught none, at four times the calls.

Measured with `bench --review` on the 12 recorded A/B changes (gamerelay.io `eval/lore-ab/cases.json`). Before (DEC-11, state checks of all 21 invariants): 0 of 6 caught, 10 false alarms, 252 model calls. After (triage, then change-focused checks, layers#DEC-8 and DEC-13): 6 of 6 caught, none skipped by triage, 58 calls. Its only other "broken" verdicts, room#INV-5 on all four host-reconnect changes, turned out real: the reclaim skips the election, so a host that dropped while hidden takes the role back from a visible stand-in; the blind A/B judge had missed it, so the cases mark it contested. Restating three GameRelay claims as guarantees changed nothing here (6 of 6 again, one new false alarm): the checks already read the rationale. On the 45 one-line cases the review caught 26 of 27 in 88 calls; the miss, a runtime dependency declared but never imported or published, is arguable, and 6 flags on related claims in three cases are unadjudicated. A manual rerun that skipped the bench's hiding read the answer key from the worktree, which is why the bench commits hidden files away first.

- depends: cli#DEC-14, layers#DEC-8

## Pipelines

```sh
# Planning
lore digest --depth 1                                # orient: the map and every node's lead
lore trace src/room/Room.ts                          # the claims a file anchors, and what rests on them
lore show room#INV-2                                 # one claim, its code and every edge, without reading the node
lore find --kind INV --tier asserted                 # invariants nothing in code anchors

# Reviewing
lore review main..HEAD --agent "$AGENT"              # reached claims, what rests on them, a verdict per invariant
lore review main..HEAD --json --agent "$AGENT" | lore record verified -   # trailers for what holds
lore gate main..HEAD --message pr.md                 # are reached invariants updated, acked or verified?

# One step at a time
lore select main..HEAD --json | lore ask - --json    # what this branch reaches, as questions
lore check main..HEAD --agent "$AGENT" --jobs 6      # check what it reaches; exit 1 if broken
lore check --sweep --agent "$AGENT"                  # every invariant, whatever changed
lore history room#INV-2                              # every commit that touched a guarantee

# Trust
lore bench lore/bench.json --agent "$AGENT"          # recall, noise, false confirmations, false alarms
lore infer --code-only --runs 2 --agent "$AGENT"     # claims an agent states from the code alone: they restate it
```

## Agents

`lore mcp` serves `lore_digest`, `lore_review`, `lore_select`, `lore_check_context`, `lore_show`,
`lore_trace`, `lore_find`, `lore_ask`, `lore_gate`, `lore_record`, `lore_history` and `lore_lint`.
Its instructions give a connected agent the two uses: when planning, read the digest, trace what
it will touch and show what it needs; when reviewing, call `lore_review`, answer its prompts from
the code and add the trailer.

```json
{ "mcpServers": { "lore": { "command": "bun", "args": ["/path/to/lore/cli/src/bin.ts", "-C", ".", "mcp"] } } }
```

## Next

- **A task run**: the same GameRelay feature task with and without the graph, counting invariants broken.
- **Cases someone else writes**, so the benchmark isn't graded by the model that wrote it.
- **Decision checks** in `bench`, before `review` checks decisions ([freshness#DEC-11](freshness.md#dec-11)).
- An opt-in `review` step in the Action, with the model command and its secret supplied by the repository.
