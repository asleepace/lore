/**
 * `lore`: small tools over a Lore graph. Each does one thing, prints text for people and JSON for
 * agents (`--json`), and reads claim records from stdin when given `-`, so they compose:
 *
 *   lore select main..HEAD --json | lore ask - --json
 *
 * Exit codes: 0 ok, 1 the check failed (lint errors, unmet gates under `block`), 2 usage error.
 */
// @lore cli#DEC-1, cli#DEC-2
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { ask } from './ask';
import { bench, type BenchSummary, type CaseResult } from './bench';
import { review, reviewContext, reviewText } from './review';
import { infer, inferText } from './infer';
import { checkAll, prepare, sweepTargets, type CheckRecord } from './check';
import { digest } from './digest';
import { checkGates } from './gate';
import { linkFor, loadGraph } from './graph';
import { serve } from './mcp';
import { history } from './history';
import { find, show, showNode, trace, type NodeShown, type Shown, type TraceRow } from './query';
import { diffFor, selectClaims } from './select';
import { tierOf } from './tiers';
import type { ClaimRecord, Graph, Issue } from './types';
import { normalizeRef } from './util';

const HELP = `lore: small tools over a Lore graph (spec v0.4)

usage: lore [-C <dir>] [--today YYYY-MM-DD] <command> [options] [--json]

  review [<range>|--staged] what a change could break, and whether it does: reached claims, what rests
         [--agent <cmd>]      on them, and a verdict on every invariant (all of them up to --max 50)
         [--jobs n] [--max n] [--selected] [--depth n]
                              without an agent: the review context, for a calling agent to answer
  graph                     the whole graph: nodes, claims, markers, tiers
  lint                      check the graph against the spec (exit 1 on errors)
  digest [--depth 0-3]      render the graph at a depth (default 1)
         [--node <id>] [--files <path>...]
  select [<range>|--staged] claims a change might break, with severity and reasons
         [--no-covers]        (no range: the work tree against the index)
  ask <ref>...|-            the question each claim poses
  check [<range>|<ref>...|-] check claims against the code with a model command; exit 1 if any broken
        [--agent <cmd>]       (or $LORE_AGENT) reads a prompt on stdin, prints "VERDICT: holds|broken|unsure"
        [--all]               with a range, also check low-severity claims
        [--jobs <n>]          checks at once (default 4)
        [--sweep]             every active invariant, whatever changed (selection only sees marker regions)
                              without an agent: print the prompts, for a calling agent to answer
  gate [<range>|--staged]   invariant gates for a change; exit 1 if unmet and gate is block
       [--message <file>] [--policy off|warn|block]
  show <ref|node>...        one claim (or node) with its anchors and every edge, without reading the node
  trace <ref|node|path>...|- claims connected to these, breadth-first, as a table
        [--up|--both]         default down: what rests on them, so what a change to them can break
        [--depth n]           hops along depends and mentions (default 3)
        [--no-code]           skip claims that share an anchored file (followed one hop only)
  find [<word>...]          claims matching every filter; records pipe into ask, check, trace
       [--kind INV,DEC,NOTE] [--node <id>] [--file <path|dir|glob>] [--tier tested|anchored|asserted]
  history <ref>...|-        commits whose message or diff mentions a claim
  record verified|ack <ref>...   print the trailer lines for a commit or PR
  link <ref>...|- [--from <file>] the markdown link for a reference
  bench <cases.json>        break claims on purpose in throwaway worktrees; measure selection and checks
        [--agent <cmd>] [--jobs n] [--only id,...] [--hide <path>] [--rev <rev>]
                              without an agent, measures selection only; exit 1 on a false confirmation
  infer [<ref>...|-]        which claims an agent works out from the code alone (blind, then graded):
        [--agent <cmd>]       those restate the code. Runs in a worktree with the graph deleted
        [--kind INV,DEC,NOTE] [--code-only] [--runs n] [--jobs n] [--hide <path>] [--rev <rev>]
                              --runs n: inferred only if every run infers it (verdicts vary run to run)
                              --code-only also deletes every markdown file; without an agent, the prompts
  mcp                       serve these commands as MCP tools over stdio

Refs are node#PREFIX-n (room#INV-2). --all includes retired and superseded claims (show, trace, find). "-" reads refs or claim records (JSON) from stdin.`;

interface Args {
  cmd: string;
  pos: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const pos: string[] = [];
  const takesValue = new Set(['-C', '--depth', '--node', '--files', '--message', '--policy', '--from', '--limit', '--bot', '--agent', '--timeout', '--today', '--kind', '--file', '--tier', '--jobs', '--only', '--hide', '--rev', '--max', '--runs']);
  let cmd = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (takesValue.has(a)) {
      const vals = flags.get(a) ?? [];
      // --files takes every following non-flag argument
      if (a === '--files') while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) vals.push(argv[++i]!);
      else vals.push(argv[++i] ?? '');
      flags.set(a, vals);
    } else if (a.startsWith('--')) flags.set(a, ['true']);
    else if (!cmd) cmd = a;
    else pos.push(a);
  }
  return { cmd, pos, flags };
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Refs from arguments, or from stdin when the only argument is `-`: JSON records, a JSON array of strings, or one ref per line. */
function refsFrom(pos: string[]): { ref: string }[] {
  if (!(pos.length === 1 && pos[0] === '-')) return pos.map((ref) => ({ ref }));
  const text = readStdin().trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    const data = JSON.parse(text) as unknown;
    const obj = data as { claims?: unknown[]; items?: unknown[] };
    const arr = Array.isArray(data) ? data : (obj.claims ?? obj.items ?? [data]);
    return arr.map((x) => (typeof x === 'string' ? { ref: x } : (x as { ref: string })));
  }
  return text.split('\n').map((l) => l.trim().split(/\s+/)[0]!).filter(Boolean).map((ref) => ({ ref }));
}

function print(json: boolean, data: unknown, text: () => string): void {
  process.stdout.write(json ? JSON.stringify(data, null, 2) + '\n' : text());
}

function issueText(issues: Issue[]): string {
  if (!issues.length) return 'no issues\n';
  return issues.map((i) => `${i.level.padEnd(5)} ${i.code} ${i.where}: ${i.message}`).join('\n') + '\n';
}

function recordsText(records: ClaimRecord[], extra?: (r: ClaimRecord) => string, label?: (r: ClaimRecord) => string): string {
  if (!records.length) return 'no claims\n';
  return records
    .map((r) => {
      const head = `${(label ? label(r) : r.severity ?? r.kind.toLowerCase()).padEnd(8)} ${r.ref}  ${r.statement}`;
      const why = r.reasons?.length ? `\n         ${r.reasons.join('; ')}` : '';
      return head + why + (extra ? `\n         ${extra(r)}` : '');
    })
    .join('\n') + '\n';
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** A markdown table: readable in a terminal, and what an agent reads best. */
function traceTable(rows: TraceRow[]): string {
  const head = '| Hop | Claim | Relation | Statement |\n|---|---|---|---|\n';
  return head + rows.map((r) => `| ${r.hop} | ${r.ref}${r.active ? '' : ' (inactive)'} | ${cell(r.via)} | ${cell(r.statement)} |`).join('\n') + '\n';
}

function showText(x: Shown | NodeShown): string {
  if ('id' in x) {
    const lines = [`${x.id} (${x.path})${x.parent ? `, under ${x.parent}` : ''}`, `  ${x.lead}`];
    if (x.children.length) lines.push(`  children: ${x.children.join(', ')}`);
    if (x.openSections.length) lines.push(`  sections: ${x.openSections.join(', ')}`);
    for (const c of x.claims) lines.push(`  ${c.ref}${c.active ? '' : ' (inactive)'}  ${c.statement}`);
    return lines.join('\n') + '\n';
  }
  const kind = { INV: 'invariant', DEC: 'decision', NOTE: 'note' }[x.kind];
  const lines = [`${x.ref}  ${kind}${x.tier ? `, ${x.tier}` : ''}${x.active ? '' : ', inactive'}  (${x.at})`, `  ${x.statement}`];
  for (const p of x.rationale) lines.push(...p.split(/\n(?=Rejected:)/).map((q) => `  ${q.replace(/\s*\n\s*/g, ' ')}`));
  const anchors = x.anchors.map((a) => (a.line ? `${a.file}:${a.line}-${a.endLine}${a.via === 'see' ? ' (see)' : ''}` : `${a.file} (${a.via})`));
  const rows: [string, string[]][] = [
    ['anchored in', anchors],
    ['depends on', x.edges.dependsOn],
    ['depended on by', x.edges.dependedOnBy],
    ['mentions', x.edges.mentions],
    ['mentioned by', x.edges.mentionedBy],
    ['superseded by', x.edges.supersededBy],
    ['supersedes', x.edges.supersedes],
    ['same code', x.edges.sameCode],
  ];
  for (const [k, v] of rows) if (v.length) lines.push(`  ${k}: ${v.join(', ')}`);
  const meta = Object.entries(x.meta).filter(([k]) => !['depends', 'files', 'tests', 'superseded_by'].includes(k));
  if (meta.length) lines.push(`  ${meta.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  return lines.join('\n') + '\n';
}

function benchText(results: CaseResult[], s: BenchSummary, checked: boolean): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
  const head = '| Case | Claim | Expect | Selected | Others | Verdict | Outcome |\n|---|---|---|---|---|---|---|\n';
  const rows = results
    .map((r) => `| ${r.id} | ${r.ref} | ${r.expect} | ${r.selected ?? 'no'} | ${r.others.length} | ${r.verdict ?? '-'} | ${r.error ? `error: ${cell(r.error)}` : r.outcome} |`)
    .join('\n');
  const lines = [
    '',
    `${s.cases} cases: ${s.broken} broken, ${s.holds} intact${s.errors ? `, ${s.errors} errors` : ''}`,
    `selection reached ${s.selected} of ${s.broken} broken claims (${pct(s.selected, s.broken)})`,
    `selection noise: ${s.othersReached} other claims reached across ${s.edited} edits (${s.edited ? (s.othersReached / s.edited).toFixed(1) : '0'} per edit)`,
  ];
  if (checked) {
    lines.push(
      `checks caught ${s.caught} of ${s.broken} (${pct(s.caught, s.broken)}); false confirmations ${s.falseConfirmations}, false alarms ${s.falseAlarms} of ${s.holds}, unsure ${s.unsure}`,
      `the per-change loop alone (select, then check) caught ${s.caughtBySelection} of ${s.broken}; a sweep catches what checks catch`,
    );
  }
  return head + rows + '\n' + lines.join('\n') + '\n';
}

function graphJson(g: Graph) {
  return {
    root: g.root,
    version: g.version,
    folders: g.folders,
    public: g.publicFolders,
    gate: g.gate,
    nodes: [...g.nodes.values()].map((n) => ({
      id: n.id,
      path: n.path,
      parent: n.id === 'lore' ? null : n.parent,
      title: n.title,
      lead: n.lead,
      openSections: n.openSections,
      claims: n.claims.map((c) => ({ ref: c.ref, kind: c.kind, prefix: c.prefix, statement: c.statement, active: c.active, tier: tierOf(g, c), meta: c.meta, line: c.line })),
    })),
    markers: g.markers,
  };
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  const json = args.flags.has('--json');
  if (!args.cmd || args.cmd === 'help' || args.flags.has('--help')) {
    process.stdout.write(HELP + '\n');
    return args.cmd ? 0 : 2;
  }
  const root = resolvePath(args.flags.get('-C')?.[0] ?? process.cwd());
  if (args.cmd === 'record') {
    const [what, ...refs] = args.pos;
    if (what !== 'verified' && what !== 'ack') return usage('record verified|ack <ref>...');
    // Records piped from `check` or `review` carry a verdict: only claims that hold are verified.
    const list = refsFrom(refs)
      .filter((r) => {
        if (what !== 'verified') return true;
        const c = r as Partial<CheckRecord> & { checked?: boolean };
        // A review's unchecked items (decisions, notes) were never judged, so they aren't verified.
        return c.checked !== false && (c.verdict === undefined || c.verdict === 'holds');
      })
      .map((r) => normalizeRef(r.ref));
    const line = `Lore-${what === 'ack' ? 'Ack' : 'Verified'}: ${list.join(', ')}`;
    if (!list.length) {
      print(json, { trailer: null, refs: [] }, () => '');
      return refs.length === 1 && refs[0] === '-' ? 0 : 2;
    }
    print(json, { trailer: line, refs: list }, () => line + '\n');
    return 0;
  }

  if (args.cmd === 'mcp') {
    serve(root);
    return -1; // keeps running; the server exits when stdin closes
  }

  let graph: Graph;
  try {
    graph = loadGraph(root, { today: args.flags.get('--today')?.[0] });
  } catch (err) {
    process.stderr.write(`lore: ${(err as Error).message}\n`);
    return 2;
  }

  switch (args.cmd) {
    case 'graph':
      print(true, graphJson(graph), () => '');
      return 0;

    case 'lint': {
      const levels = { error: 0, warn: 1, info: 2 };
      const issues = [...graph.issues].sort((a, b) => levels[a.level] - levels[b.level] || a.code.localeCompare(b.code));
      const invs = [...graph.claims.values()].filter((c) => c.kind === 'INV' && c.active);
      const tiers = { tested: 0, anchored: 0, asserted: 0 };
      for (const c of invs) tiers[tierOf(graph, c)!]++;
      const kinds = { INV: 0, DEC: 0, NOTE: 0 };
      for (const c of graph.claims.values()) if (c.active) kinds[c.kind]++;
      const summary = { nodes: graph.nodes.size, claims: kinds, markers: graph.markers.length, tiers, version: graph.version };
      print(json, { summary, issues }, () =>
        `lore ${graph.version}: ${summary.nodes} nodes, ${kinds.INV} INV / ${kinds.DEC} DEC / ${kinds.NOTE} NOTE, ${summary.markers} markers\n` +
        `invariants: ${tiers.tested} tested, ${tiers.anchored} anchored, ${tiers.asserted} asserted\n` +
        issueText(issues),
      );
      return issues.some((i) => i.level === 'error') ? 1 : 0;
    }

    case 'digest': {
      const depth = Number(args.flags.get('--depth')?.[0] ?? '1');
      if (!(depth >= 0 && depth <= 3)) return usage('--depth must be 0, 1, 2 or 3');
      const node = args.flags.get('--node')?.[0];
      if (node && !graph.nodes.has(node)) return usage(`no node "${node}"`);
      const text = digest(graph, { depth, node, files: args.flags.get('--files') });
      print(json, { depth, text }, () => text);
      return 0;
    }

    case 'review': {
      const opts = {
        range: args.pos[0],
        staged: args.flags.has('--staged'),
        max: Number(args.flags.get('--max')?.[0] ?? '50'),
        selectedOnly: args.flags.has('--selected'),
        depth: Number(args.flags.get('--depth')?.[0] ?? '1'),
      };
      const agent = args.flags.get('--agent')?.[0] ?? process.env.LORE_AGENT;
      if (!agent) {
        const ctx = reviewContext(graph, opts);
        print(json, ctx, () => reviewText(ctx, false));
        return 0;
      }
      review(graph, {
        ...opts,
        agent,
        jobs: Number(args.flags.get('--jobs')?.[0] ?? '6'),
        timeoutMs: Number(args.flags.get('--timeout')?.[0] ?? '240') * 1000,
        onResult: (r) => process.stderr.write(`${(r.verdict ?? 'unsure').padEnd(6)} ${r.ref}\n`),
      })
        .then((r) => {
          print(json, r, () => reviewText(r, true));
          process.exit(r.items.some((i) => i.verdict === 'broken') ? 1 : 0);
        })
        .catch((err: Error) => {
          process.stderr.write(`lore: ${err.message}\n`);
          process.exit(2);
        });
      return -1;
    }

    case 'select': {
      const records = selectClaims(graph, diffFor(root, args.pos[0], args.flags.has('--staged')), { covers: !args.flags.has('--no-covers') });
      print(json, records, () => recordsText(records));
      return 0;
    }

    case 'ask': {
      const wanted = refsFrom(args.pos);
      if (!wanted.length) return usage('ask <ref>... or ask -');
      const records = ask(graph, wanted);
      const missing = wanted.filter((w) => !graph.claims.has(normalizeRef(w.ref))).map((w) => w.ref);
      if (missing.length) process.stderr.write(`lore: no claim ${missing.join(', ')}\n`);
      print(json, records, () => records.map((r) => `${r.ref}\n  ${r.question}`).join('\n') + '\n');
      return 0;
    }

    case 'check': {
      const isRefs = args.pos.length > 0 && (args.pos[0] === '-' || args.pos.every((p) => p.includes('#') && !p.includes('..')));
      let wanted: { ref: string }[];
      if (args.flags.has('--sweep')) wanted = sweepTargets(graph);
      else if (isRefs) wanted = refsFrom(args.pos);
      else {
        const picked = selectClaims(graph, diffFor(root, args.pos[0], args.flags.has('--staged')), { covers: false });
        wanted = args.flags.has('--all') ? picked : picked.filter((r) => r.severity !== 'low');
      }
      const agent = args.flags.get('--agent')?.[0] ?? process.env.LORE_AGENT;
      const timeoutMs = Number(args.flags.get('--timeout')?.[0] ?? '180') * 1000;
      if (!agent) {
        const results = prepare(graph, wanted);
        print(json, results, () => results.map((r) => `=== ${r.ref}\n${r.prompt}\n`).join('\n') || 'no claims\n');
        return 0;
      }
      checkAll(graph, wanted, { agent, timeoutMs, jobs: Number(args.flags.get('--jobs')?.[0] ?? '4') })
        .then((results) => {
          print(json, results, () =>
            results.length
              ? results.map((r) => `${(r.verdict ?? 'unsure').padEnd(6)} ${r.ref}  ${r.statement}\n         ${(r.answer ?? '').split('\n').slice(1).join(' ').trim().slice(0, 300)}`).join('\n') + '\n'
              : 'no claims\n',
          );
          process.exit(results.some((r) => r.verdict === 'broken') ? 1 : 0);
        })
        .catch((err: Error) => {
          process.stderr.write(`lore: ${err.message}\n`);
          process.exit(2);
        });
      return -1;
    }

    case 'gate': {
      const policy = (args.flags.get('--policy')?.[0] ?? graph.gate) as Graph['gate'];
      const msgFile = args.flags.get('--message')?.[0];
      const bot = args.flags.get('--bot')?.[0];
      const { results, skipped } = checkGates(graph, {
        range: args.pos[0],
        staged: args.flags.has('--staged'),
        message: msgFile ? readFileSync(msgFile === '-' ? 0 : resolvePath(root, msgFile), 'utf8') : undefined,
        bot: bot ? new RegExp(bot) : undefined,
      });
      const unmet = results.filter((r) => r.status === 'unmet');
      print(json, { policy, skipped: skipped ?? null, results }, () => {
        if (skipped) return `gates skipped: ${skipped}\n`;
        if (!results.length) return 'no invariants reached\n';
        const body = recordsText(results, (r) => (r as (typeof results)[number]).status);
        const tail = unmet.length
          ? `\n${unmet.length} unmet. Update the claim, or add a trailer:\n  ${`Lore-Ack: ${unmet.map((r) => r.ref).join(', ')}`}\n`
          : '\nall gates met\n';
        return body + tail;
      });
      return policy === 'block' && unmet.length ? 1 : 0;
    }

    case 'show': {
      const wanted = refsFrom(args.pos).map((r) => r.ref);
      if (!wanted.length) return usage('show <ref|node>...');
      const out = wanted.map((w) => (w.includes('#') ? show(graph, w) : showNode(graph, w)));
      const missing = wanted.filter((_, i) => !out[i]);
      if (missing.length) {
        process.stderr.write(`lore: no claim or node ${missing.join(', ')}\n`);
        if (missing.length === wanted.length) return 2;
      }
      const found = out.filter((x) => !!x);
      print(json, found.length === 1 ? found[0] : found, () => found.map(showText).join('\n'));
      return 0;
    }

    case 'trace': {
      const inputs = refsFrom(args.pos).map((r) => r.ref);
      if (!inputs.length) return usage('trace <ref|node|path>... or trace -');
      const depth = Number(args.flags.get('--depth')?.[0] ?? '3');
      if (!(depth >= 0)) return usage('--depth must be a number');
      const direction = args.flags.has('--both') ? 'both' : args.flags.has('--up') ? 'up' : 'down';
      const { starts, rows } = trace(graph, inputs, { direction, depth, code: !args.flags.has('--no-code'), inactive: args.flags.has('--all') });
      const empty = starts.filter((s) => !s.refs.length).map((s) => s.input);
      if (empty.length) process.stderr.write(`lore: nothing found for ${empty.join(', ')}\n`);
      print(json, rows, () => (rows.length ? traceTable(rows) : 'no claims\n'));
      return 0;
    }

    case 'find': {
      const kinds = (args.flags.get('--kind')?.[0] ?? '').split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
      if (kinds.some((k) => !['INV', 'DEC', 'NOTE'].includes(k))) return usage('--kind takes INV, DEC, NOTE');
      const tier = args.flags.get('--tier')?.[0];
      if (tier && !['tested', 'anchored', 'asserted'].includes(tier)) return usage('--tier takes tested, anchored, asserted');
      const node = args.flags.get('--node')?.[0];
      if (node && !graph.nodes.has(node)) return usage(`no node "${node}"`);
      const records = find(graph, {
        text: args.pos,
        kinds: kinds as ('INV' | 'DEC' | 'NOTE')[],
        node,
        file: args.flags.get('--file')?.[0],
        tier: tier as 'tested' | 'anchored' | 'asserted' | undefined,
        inactive: args.flags.has('--all'),
      });
      print(json, records, () => recordsText(records, undefined, (r) => (r as (typeof records)[number]).tier ?? r.kind.toLowerCase()));
      return 0;
    }

    case 'infer': {
      const agent = args.flags.get('--agent')?.[0] ?? process.env.LORE_AGENT;
      const refs = args.pos.length ? refsFrom(args.pos).map((r) => r.ref) : undefined;
      const kinds = args.flags.get('--kind')?.[0]?.split(',').map((k) => k.trim().toUpperCase()) as ('INV' | 'DEC' | 'NOTE')[] | undefined;
      infer(graph, {
        refs,
        kinds,
        agent,
        jobs: Number(args.flags.get('--jobs')?.[0] ?? '6'),
        timeoutMs: Number(args.flags.get('--timeout')?.[0] ?? '240') * 1000,
        rev: args.flags.get('--rev')?.[0],
        codeOnly: args.flags.has('--code-only'),
        hide: args.flags.get('--hide'),
        runs: Number(args.flags.get('--runs')?.[0] ?? '1'),
        onResult: (r) => process.stderr.write(`${(r.verdict ?? '-').padEnd(9)} ${r.ref}\n`),
      })
        .then(({ results, summary }) => {
          print(json, { agent: agent ?? null, summary, results }, () => inferText(results, summary, !!agent));
          process.exit(0);
        })
        .catch((err: Error) => {
          process.stderr.write(`lore: ${err.message}\n`);
          process.exit(2);
        });
      return -1;
    }

    case 'bench': {
      const casesPath = args.pos[0];
      if (!casesPath) return usage('bench <cases.json>');
      const agent = args.flags.get('--agent')?.[0] ?? process.env.LORE_AGENT;
      const started = Date.now();
      bench(root, resolvePath(root, casesPath), {
        agent,
        jobs: Number(args.flags.get('--jobs')?.[0] ?? '4'),
        timeoutMs: Number(args.flags.get('--timeout')?.[0] ?? '240') * 1000,
        rev: args.flags.get('--rev')?.[0],
        hide: args.flags.get('--hide'),
        only: args.flags.get('--only')?.[0]?.split(',').map((x) => x.trim()),
        onResult: (r) => process.stderr.write(`${r.outcome.padEnd(9)} ${r.id}\n`),
      })
        .then(({ results, summary }) => {
          print(json, { agent: agent ?? null, seconds: Math.round((Date.now() - started) / 1000), summary, results }, () => benchText(results, summary, !!agent));
          process.exit(summary.falseConfirmations ? 1 : 0);
        })
        .catch((err: Error) => {
          process.stderr.write(`lore: ${err.message}\n`);
          process.exit(2);
        });
      return -1;
    }

    case 'history': {
      // One ref prints its entries; several, or `-`, print one group per ref.
      const refs = refsFrom(args.pos).map((r) => r.ref);
      if (!refs.length) return usage('history <ref>... or history -');
      const missing = refs.find((r) => !graph.claims.has(normalizeRef(r)) && !graph.nodes.has(normalizeRef(r)));
      if (missing) return usage(`no claim or node "${missing}"`);
      const limit = Number(args.flags.get('--limit')?.[0] ?? '50');
      const groups = refs.map((ref) => ({ ref: normalizeRef(ref), entries: history(graph, ref, limit) }));
      const lines = (entries: (typeof groups)[number]['entries']) =>
        entries.length ? entries.map((e) => `${e.commit.slice(0, 7)} ${e.date} ${e.subject}  [${e.via.join(', ')}]`).join('\n') + '\n' : 'no history\n';
      const single = args.pos.length === 1 && args.pos[0] !== '-';
      print(json, single ? groups[0]!.entries : groups, () => (single ? lines(groups[0]!.entries) : groups.map((g) => `== ${g.ref}\n${lines(g.entries)}`).join('\n')));
      return 0;
    }

    case 'link': {
      const refs = refsFrom(args.pos).map((r) => r.ref);
      if (!refs.length) return usage('link <ref>... or link -');
      const from = args.flags.get('--from')?.[0] ?? 'LORE.md';
      const links = refs.map((ref) => ({ ref: normalizeRef(ref), link: linkFor(graph, ref, from) }));
      const missing = links.find((l) => !l.link);
      if (missing) return usage(`no claim or node "${missing.ref}"`);
      const single = args.pos.length === 1 && args.pos[0] !== '-';
      print(json, single ? links[0] : links, () => links.map((l) => `[${l.ref}](${l.link})`).join('\n') + '\n');
      return 0;
    }

    default:
      return usage(`unknown command "${args.cmd}"`);
  }
}

function usage(msg: string): number {
  process.stderr.write(`lore: ${msg}\nrun "lore help" for usage\n`);
  return 2;
}

