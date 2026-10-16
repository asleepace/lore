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
import { check, sweepTargets, type CheckRecord } from './check';
import { digest } from './digest';
import { checkGates } from './gate';
import { linkFor, loadGraph } from './graph';
import { serve } from './mcp';
import { history } from './history';
import { diffFor, selectClaims } from './select';
import { tierOf } from './tiers';
import type { ClaimRecord, Graph, Issue } from './types';
import { normalizeRef } from './util';

const HELP = `lore: small tools over a Lore graph (spec v0.3)

usage: lore [-C <dir>] [--today YYYY-MM-DD] <command> [options] [--json]

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
        [--sweep]             every active invariant, whatever changed (selection only sees marker regions)
                              without an agent: print the prompts, for a calling agent to answer
  gate [<range>|--staged]   invariant gates for a change; exit 1 if unmet and gate is block
       [--message <file>] [--policy off|warn|block]
  history <ref>             commits whose message or diff mentions a claim
  record verified|ack <ref>...   print the trailer lines for a commit or PR
  link <ref> [--from <file>]     the markdown link for a reference
  mcp                       serve these commands as MCP tools over stdio

Refs are node#PREFIX-n (room#INV-2). "-" reads refs or claim records (JSON) from stdin.`;

interface Args {
  cmd: string;
  pos: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const pos: string[] = [];
  const takesValue = new Set(['-C', '--depth', '--node', '--files', '--message', '--policy', '--from', '--limit', '--bot', '--agent', '--timeout', '--today']);
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
    const arr = Array.isArray(data) ? data : ((data as { claims?: unknown[] }).claims ?? [data]);
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

function recordsText(records: ClaimRecord[], extra?: (r: ClaimRecord) => string): string {
  if (!records.length) return 'no claims\n';
  return records
    .map((r) => {
      const head = `${(r.severity ?? r.kind.toLowerCase()).padEnd(6)} ${r.ref}  ${r.statement}`;
      const why = r.reasons?.length ? `\n         ${r.reasons.join('; ')}` : '';
      return head + why + (extra ? `\n         ${extra(r)}` : '');
    })
    .join('\n') + '\n';
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
    // Records piped from `check` carry a verdict: only claims that hold are verified.
    const list = refsFrom(refs)
      .filter((r) => what !== 'verified' || (r as Partial<CheckRecord>).verdict === undefined || (r as Partial<CheckRecord>).verdict === 'holds')
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
      const results = check(graph, wanted, { agent, timeoutMs });
      if (!agent) {
        print(json, results, () => results.map((r) => `=== ${r.ref}\n${r.prompt}\n`).join('\n') || 'no claims\n');
        return 0;
      }
      print(json, results, () =>
        results.length
          ? results.map((r) => `${(r.verdict ?? 'unsure').padEnd(6)} ${r.ref}  ${r.statement}\n         ${(r.answer ?? '').split('\n').slice(1).join(' ').trim().slice(0, 300)}`).join('\n') + '\n'
          : 'no claims\n',
      );
      return results.some((r) => r.verdict === 'broken') ? 1 : 0;
    }

    case 'gate': {
      const policy = (args.flags.get('--policy')?.[0] ?? graph.gate) as Graph['gate'];
      const msgFile = args.flags.get('--message')?.[0];
      const bot = args.flags.get('--bot')?.[0];
      const { results, skipped } = checkGates(graph, {
        range: args.pos[0],
        staged: args.flags.has('--staged'),
        message: msgFile ? readFileSync(msgFile === '-' ? 0 : msgFile, 'utf8') : undefined,
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

    case 'history': {
      const ref = args.pos[0];
      if (!ref) return usage('history <ref>');
      if (!graph.claims.has(normalizeRef(ref)) && !graph.nodes.has(normalizeRef(ref))) return usage(`no claim or node "${ref}"`);
      const entries = history(graph, ref, Number(args.flags.get('--limit')?.[0] ?? '50'));
      print(json, entries, () =>
        entries.length ? entries.map((e) => `${e.commit.slice(0, 7)} ${e.date} ${e.subject}  [${e.via.join(', ')}]`).join('\n') + '\n' : 'no history\n',
      );
      return 0;
    }

    case 'link': {
      const ref = args.pos[0];
      if (!ref) return usage('link <ref>');
      const link = linkFor(graph, ref, args.flags.get('--from')?.[0] ?? 'LORE.md');
      if (!link) return usage(`no claim or node "${ref}"`);
      print(json, { ref: normalizeRef(ref), link }, () => `[${normalizeRef(ref)}](${link})\n`);
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

