import { createInterface } from 'node:readline';
import { ask } from './ask';
import { prepare, sweepTargets } from './check';
import { digest } from './digest';
import { checkGates } from './gate';
import { loadGraph } from './graph';
import { history } from './history';
import { find, show, showNode, trace } from './query';
import { reviewContext } from './review';
import { diffFor, selectClaims } from './select';
import { tierOf } from './tiers';
import { normalizeRef } from './util';

/**
 * `lore mcp`: the same functions as the commands, served as MCP tools over stdio (JSON-RPC 2.0, one
 * message per line). No SDK, so no dependency. The check tool returns prompts for the calling agent
 * to answer itself; the server never calls a model.
 */
// @lore cli#DEC-7

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * The version to answer `initialize` with: the client's if supported, else the newest supported one
 * not newer than it (versions are dates), else the newest. Answering a version newer than the
 * client knows is what made Claude Code 2.1 refuse the server.
 */
export function negotiate(asked: string): string {
  if (SUPPORTED.includes(asked)) return asked;
  return SUPPORTED.find((v) => v <= asked) ?? SUPPORTED[0]!;
}
const VERSION = '0.3.0-draft';

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  run(root: string, input: Json): unknown;
}

const str = (description: string) => ({ type: 'string', description });
const refs = { type: 'array', items: { type: 'string' }, description: 'Claim references, node#PREFIX-n (room#INV-2).' };
const range = str('A git range (main..HEAD, or base...head for a PR). Omitted: the work tree against HEAD.');
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS: Tool[] = [
  {
    name: 'lore_digest',
    title: 'Read the knowledge graph',
    description:
      "Read this repository's Lore graph at a depth: 0 the root's summary, 1 the map with each node's summary, 2 plus every claim's statement, 3 the full text. Pass files to get only the claims around the files you are about to change. Start here before changing code.",
    inputSchema: { type: 'object', properties: { depth: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, node: str('Only this node and its children.'), files: { type: 'array', items: { type: 'string' } } } },
    annotations: readOnly,
    run: (root, i) => digest(loadGraph(root), { depth: Number(i.depth ?? 1), node: i.node as string | undefined, files: i.files as string[] | undefined }),
  },
  {
    name: 'lore_review',
    title: 'Review a change',
    description:
      'What a change could break: the claims it reaches (with severity and why), what rests on each, and the prompt for checking each reached invariant. alsoCheck lists the other invariants to check when the graph is small, because selection misses callers and other files; get their prompts with lore_check_context. Answer each prompt from the code ("VERDICT: holds|broken|unsure"), then call lore_record for those that hold. Decisions and notes are context, not checked.',
    inputSchema: { type: 'object', properties: { range, max: { type: 'integer', default: 50, description: 'Check every invariant up to this many.' } } },
    annotations: readOnly,
    run: (root, i) => {
      const r = reviewContext(loadGraph(root), { range: (i.range as string | undefined) ?? 'HEAD', max: Number(i.max ?? 50) });
      const reached = r.items.filter((x) => x.severity);
      return {
        range: r.range,
        scope: r.scope,
        reached: reached.map(({ ref, kind, statement, severity, reasons, downstream, checked, question, prompt }) => ({ ref, kind, statement, severity, reasons, downstream, checked, question, prompt })),
        alsoCheck: r.items.filter((x) => !x.severity && x.checked).map((x) => x.ref),
      };
    },
  },
  {
    name: 'lore_select',
    title: 'Claims a change might break',
    description:
      'List the claims a change might break, each with a severity (high for invariants, medium for decisions, low for notes and dependents) and the reasons. Deterministic. Use it after editing and before committing.',
    inputSchema: { type: 'object', properties: { range, covers: { type: 'boolean', default: false, description: 'Also flag every claim of nodes whose covered files changed.' } } },
    annotations: readOnly,
    run: (root, i) => selectClaims(loadGraph(root), diffFor(root, (i.range as string | undefined) ?? 'HEAD'), { covers: i.covers === true }),
  },
  {
    name: 'lore_check_context',
    title: 'Prepare claim checks',
    description:
      'For each claim, the prompt for checking it: the claim, its question and the code that upholds it. Answer each yourself from the code, starting with "VERDICT: holds", "VERDICT: broken" or "VERDICT: unsure", then call lore_record for the claims that hold. With a range instead of refs, prepares the high and medium claims the change reaches; with sweep, every active invariant.',
    inputSchema: { type: 'object', properties: { refs, range, sweep: { type: 'boolean', default: false, description: 'Prepare every active invariant, whatever changed.' } } },
    annotations: readOnly,
    run: (root, i) => {
      const g = loadGraph(root);
      const wanted = i.sweep === true
        ? sweepTargets(g)
        : Array.isArray(i.refs) && i.refs.length
        ? (i.refs as string[]).map((ref) => ({ ref }))
        : selectClaims(g, diffFor(root, (i.range as string | undefined) ?? 'HEAD'), { covers: false }).filter((r) => r.severity !== 'low');
      return prepare(g, wanted).map(({ ref, kind, statement, severity, question, prompt }) => ({ ref, kind, statement, severity, question, prompt }));
    },
  },
  {
    name: 'lore_show',
    title: 'One claim or node, with its edges',
    description:
      'A claim with its full text, tier, where its code is (file:line), and every edge: what it depends on, what depends on it, what it mentions, what mentions it, and claims upheld by the same code. A node ID gives its summary, children and claim list. Cheaper than reading the node file.',
    inputSchema: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' }, description: 'Claim references (room#INV-2) or node IDs (room).' } }, required: ['refs'] },
    annotations: readOnly,
    run: (root, i) => {
      const g = loadGraph(root);
      return ((i.refs as string[]) ?? []).map((r) => (r.includes('#') ? show(g, r) : showNode(g, r)) ?? { ref: r, error: 'no such claim or node' });
    },
  },
  {
    name: 'lore_trace',
    title: 'What rests on a claim, node or file',
    description:
      'Claims connected to a start, breadth-first, each with its hop count and how it was reached. Start from claim refs, node IDs or file paths (a file starts from every claim anchored in it). direction "down" (default) lists what rests on the starts, so what changing them can break; "up" what they rest on. Use it before changing an invariant or a file that upholds one.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'array', items: { type: 'string' }, description: 'Claim refs, node IDs, or repository paths (files, directories, globs).' },
        direction: { type: 'string', enum: ['down', 'up', 'both'], default: 'down' },
        depth: { type: 'integer', minimum: 0, default: 3, description: 'Hops along depends and mentions.' },
        code: { type: 'boolean', default: true, description: 'Include claims upheld by the same code (one hop).' },
      },
      required: ['from'],
    },
    annotations: readOnly,
    run: (root, i) =>
      trace(loadGraph(root), (i.from as string[]) ?? [], {
        direction: (i.direction as 'down' | 'up' | 'both' | undefined) ?? 'down',
        depth: Number(i.depth ?? 3),
        code: i.code !== false,
      }).rows.map(({ ref, kind, statement, hop, via }) => ({ ref, kind, hop, via, statement })),
  },
  {
    name: 'lore_find',
    title: 'Find claims',
    description:
      'Claims matching every filter given: words in the text, kind (INV, DEC, NOTE), a node and the nodes under it, a file they are anchored in, or an invariant tier (tested, anchored, asserted).',
    inputSchema: {
      type: 'object',
      properties: {
        text: str('Words that must all appear (case-insensitive).'),
        kind: { type: 'array', items: { type: 'string', enum: ['INV', 'DEC', 'NOTE'] } },
        node: str('A node ID; includes the nodes under it in the map.'),
        file: str('A file, directory or glob the claims are anchored in.'),
        tier: { type: 'string', enum: ['tested', 'anchored', 'asserted'] },
      },
    },
    annotations: readOnly,
    run: (root, i) =>
      find(loadGraph(root), {
        text: String(i.text ?? '').split(/\s+/).filter(Boolean),
        kinds: i.kind as ('INV' | 'DEC' | 'NOTE')[] | undefined,
        node: i.node as string | undefined,
        file: i.file as string | undefined,
        tier: i.tier as 'tested' | 'anchored' | 'asserted' | undefined,
      }),
  },
  {
    name: 'lore_ask',
    title: 'Questions for claims',
    description: 'The question each claim poses, for self-evaluation or a quick check.',
    inputSchema: { type: 'object', properties: { refs }, required: ['refs'] },
    annotations: readOnly,
    run: (root, i) => ask(loadGraph(root), ((i.refs as string[]) ?? []).map((ref) => ({ ref }))),
  },
  {
    name: 'lore_gate',
    title: 'Invariant gates',
    description:
      'For a change, every invariant it reaches and whether it was updated, acknowledged (Lore-Ack trailer) or verified (Lore-Verified trailer). Unmet gates need one of the three before the change lands.',
    inputSchema: { type: 'object', properties: { range, message: str('A PR description or draft commit message to search for trailers.') } },
    annotations: readOnly,
    run: (root, i) => checkGates(loadGraph(root), { range: (i.range as string | undefined) ?? 'HEAD', message: i.message as string | undefined }),
  },
  {
    name: 'lore_record',
    title: 'Trailer for verified or acknowledged claims',
    description:
      'The trailer line to add to a commit message or PR description: "verified" for claims you checked and that hold, "ack" for claims a change reaches that still hold for a reason you state. Returns text; it changes nothing.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['verified', 'ack'] }, refs }, required: ['kind', 'refs'] },
    annotations: readOnly,
    run: (_root, i) => `Lore-${i.kind === 'ack' ? 'Ack' : 'Verified'}: ${((i.refs as string[]) ?? []).map(normalizeRef).join(', ')}`,
  },
  {
    name: 'lore_history',
    title: 'History of a claim',
    description: 'Commits whose message or diff mentions a claim, newest first.',
    inputSchema: { type: 'object', properties: { ref: str('A claim reference.'), limit: { type: 'integer', default: 20 } }, required: ['ref'] },
    annotations: readOnly,
    run: (root, i) => history(loadGraph(root), String(i.ref), Number(i.limit ?? 20)),
  },
  {
    name: 'lore_lint',
    title: 'Lint the graph',
    description: 'Check the graph against the Lore spec. Returns counts by claim kind, invariant trust tiers and every issue.',
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnly,
    run: (root) => {
      const g = loadGraph(root);
      const tiers = { tested: 0, anchored: 0, asserted: 0 };
      for (const c of g.claims.values()) if (c.kind === 'INV' && c.active) tiers[tierOf(g, c)!]++;
      return { version: g.version, nodes: g.nodes.size, markers: g.markers.length, tiers, issues: g.issues };
    },
  },
];

function reply(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function fail(id: unknown, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

export function handle(root: string, msg: Json): void {
  const { id, method } = msg;
  const params = (msg.params ?? {}) as Json;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      reply(id, {
        protocolVersion: negotiate(asked),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lore', title: 'Lore', version: VERSION },
        instructions:
          "This repository keeps a Lore knowledge graph: invariants (don't break them), decisions (don't re-propose what they rejected) and notes. Planning: read lore_digest (depth 1) to orient, lore_trace on the files or nodes you'll touch, lore_show for a claim in full. Reviewing: lore_review on the change, answer its prompts from the code, and add the trailer from lore_record to the commit.",
      });
      return;
    }
    case 'ping':
      if (isRequest) reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
      return;
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `unknown tool ${String(params.name)}`);
      try {
        const out = tool.run(root, (params.arguments ?? {}) as Json);
        const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
        reply(id, { content: [{ type: 'text', text }], isError: false });
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: `lore: ${(err as Error).message}` }], isError: true });
      }
      return;
    }
    default:
      if (isRequest) fail(id, -32601, `method not found: ${String(method)}`);
  }
}

export function serve(root: string): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      return fail(null, -32700, 'parse error');
    }
    handle(root, msg);
  });
  rl.on('close', () => process.exit(0));
}
