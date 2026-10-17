import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkAll, parseVerdict, promptFor, runAgent, workers } from '../src/check';
import { loadGraph } from '../src/graph';
import { negotiate } from '../src/mcp';
import { AT, BASE, makeRepo, type Repo } from './helpers';

let repo: Repo | undefined;
afterEach(() => repo?.cleanup());
const BIN = join(import.meta.dir, '../src/bin.ts');
const lore = (dir: string, args: string[], input?: string) => {
  const r = spawnSync('bun', [BIN, '-C', dir, ...args], { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
/** A stand-in for a model: says "broken" when the code it's shown has the host check disabled. */
const FAKE_AGENT = `let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  console.log(s.includes('if (false)') ? 'VERDICT: broken\\nThe check is disabled at src/room/room.ts:3.' : 'VERDICT: holds\\nThe check at src/room/room.ts:3 throws for non-hosts.');
});`;
const withAgent = () => {
  const r = makeRepo({ ...BASE, 'agent.cjs': FAKE_AGENT });
  return { r, agent: `node ${join(r.dir, 'agent.cjs')}` };
};

describe('check', () => {
  test('the prompt holds the claim, its question and the code that upholds it, with line numbers', () => {
    // @lore cli#DEC-6
    repo = makeRepo(BASE);
    const g = loadGraph(repo.dir);
    const p = promptFor(g, g.claims.get('room#INV-1')!);
    expect(p).toContain('Claim: room#INV-1, an invariant');
    expect(p).toContain('Statement: Only the host can set room state.');
    expect(p).toContain('--- src/room/room.ts:1-');
    expect(p).toMatch(/\s+3 {2}\s*if \(from !== host\) throw new Error\('not_host'\);/);
    expect(p).toContain('Tests that enforce it: test/room.test.ts');
    expect(p).toContain('VERDICT: holds');
    expect(promptFor(g, g.claims.get('room#INV-1')!)).toBe(p);
  });

  test('the prompt adds top-level definitions the region uses from elsewhere in its file, not locals or other objects\' properties', () => {
    const pad = '\n'.repeat(20);
    repo = makeRepo({
      ...BASE,
      'src/room/room.ts': `/** Players a room holds. */\nconst MAX_SEATS = 8;\n${pad}function isHost(from: string, host: string): boolean {\n  return from === host;\n}\n${pad}function length() {\n  return 0;\n}\n${pad}export function setState(from: string, host: string, seats: { length: number }) {\n  const MAX_LOCAL = 1;\n  // ${AT} room#INV-1\n  if (!isHost(from, host) || seats.length > MAX_SEATS + MAX_LOCAL) throw new Error('not_host');\n}\n`,
    });
    const g = loadGraph(repo.dir);
    const p = promptFor(g, g.claims.get('room#INV-1')!);
    expect(p).toContain('Definitions the code above uses, from elsewhere in the same file:');
    expect(p).toContain('--- src/room/room.ts:1-2\n    1  /** Players a room holds. */\n    2  const MAX_SEATS = 8;');
    expect(p).toContain('--- src/room/room.ts:23-25\n   23  function isHost(');
    expect(p).not.toContain('function length()'); // `seats.length` is a property, not this function
    expect(p).toContain('read it first, or answer unsure');
  });

  test('a timeout kills the whole agent, pipelines included, and the run moves on', async () => {
    repo = makeRepo(BASE);
    const started = Date.now();
    const r = await runAgent(repo.dir, 'prompt', { agent: 'sleep 30 | cat', timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect([r.verdict, r.failed, r.answer]).toEqual(['unsure', true, 'agent timed out']);
    expect([workers(Number('auto')), workers(0), workers(3)]).toEqual([4, 4, 3]);
  });

  test('verdicts are read from the first VERDICT line; anything else is unsure', () => {
    expect(parseVerdict('VERDICT: holds\nbecause')).toBe('holds');
    expect(parseVerdict('Thinking…\n**VERDICT: Broken**')).toBe('broken');
    expect(parseVerdict('It probably holds.')).toBe('unsure');
  });

  test('an agent command gets each prompt on stdin; a broken claim makes check exit 1', async () => {
    const { r, agent } = withAgent();
    repo = r;
    expect((await checkAll(loadGraph(r.dir), [{ ref: 'room#INV-1' }], { agent }))[0]!.verdict).toBe('holds');
    r.write('src/room/room.ts', BASE['src/room/room.ts']!.replace('if (from !== host)', 'if (false)'));
    const out = lore(r.dir, ['check', 'HEAD', '--agent', agent, '--json']);
    expect(out.code).toBe(1);
    const results = JSON.parse(out.out) as { ref: string; verdict: string }[];
    expect(results.map((x) => [x.ref, x.verdict])).toEqual([['room#INV-1', 'broken']]);
  });

  test('check | record verified - records only the claims that hold', () => {
    const { r, agent } = withAgent();
    repo = r;
    r.write('src/room/room.ts', BASE['src/room/room.ts']!.replace('return { from };', 'return { from, at: 0 };'));
    const checked = lore(r.dir, ['check', 'room#INV-1', 'room#INV-2', '--agent', agent, '--json']);
    expect(checked.code).toBe(0);
    expect(lore(r.dir, ['record', 'verified', '-'], checked.out).out).toBe('Lore-Verified: room#INV-1, room#INV-2\n');
    const mixed = JSON.stringify([{ ref: 'room#INV-1', verdict: 'holds' }, { ref: 'room#INV-2', verdict: 'broken' }]);
    expect(lore(r.dir, ['record', 'verified', '-'], mixed).out).toBe('Lore-Verified: room#INV-1\n');
  });

  test('a sweep checks every active invariant, whatever changed', () => {
    // @lore freshness#NOTE-2
    repo = makeRepo(BASE);
    const out = lore(repo.dir, ['check', '--sweep', '--json']);
    expect((JSON.parse(out.out) as { ref: string }[]).map((r) => r.ref)).toEqual(['room#INV-1', 'room#INV-2', 'host#INV-1']);
  });

  test('without an agent, check prints the prompts for a calling agent to answer', () => {
    repo = makeRepo(BASE);
    const out = lore(repo.dir, ['check', 'room#INV-1']);
    expect(out.code).toBe(0);
    expect(out.out).toContain('=== room#INV-1');
    expect(out.out).toContain('Answer on the first line');
  });
});

describe('mcp', () => {
  test('a session: initialize, list tools, read a digest, prepare checks, record', async () => {
    // @lore cli#DEC-7
    repo = makeRepo(BASE);
    repo.write('src/room/room.ts', BASE['src/room/room.ts']!.replace('if (from !== host)', 'if (false)'));
    const proc = spawn('bun', [BIN, '-C', repo.dir, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const replies: Record<number, { result?: Record<string, unknown>; error?: { code: number } }> = {};
    let buf = '';
    const done = new Promise<void>((res) => {
      proc.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const msg = JSON.parse(buf.slice(0, i)) as { id: number };
          replies[msg.id] = msg as never;
          buf = buf.slice(i + 1);
        }
        if (Object.keys(replies).length >= 7) res();
      });
    });
    const send = (m: object) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    send({ id: 3, method: 'tools/call', params: { name: 'lore_digest', arguments: { depth: 2, files: ['src/room/room.ts'] } } });
    send({ id: 4, method: 'tools/call', params: { name: 'lore_check_context', arguments: {} } });
    send({ id: 5, method: 'tools/call', params: { name: 'lore_record', arguments: { kind: 'ack', refs: ['room#inv-1'] } } });
    send({ id: 6, method: 'tools/call', params: { name: 'nope' } });
    send({ id: 7, method: 'unknown/method' });
    await done;
    proc.stdin.end();

    expect((replies[1]!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
    // Claude Code 2.1 asks 2025-11-25; an unknown newer date gets our newest, an unknown older one the newest before it.
    expect([negotiate('2025-11-25'), negotiate('2099-01-01'), negotiate('2025-09-01'), negotiate('2024-01-01')]).toEqual(['2025-11-25', '2025-11-25', '2025-06-18', '2025-11-25']);
    const tools = (replies[2]!.result as { tools: { name: string; inputSchema: object }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(['lore_digest', 'lore_review', 'lore_select', 'lore_check_context', 'lore_show', 'lore_trace', 'lore_find', 'lore_ask', 'lore_gate', 'lore_record', 'lore_history', 'lore_lint']);
    const text = (id: number) => ((replies[id]!.result as { content: { text: string }[] }).content[0]!.text);
    expect(text(3)).toContain('room#INV-1');
    const prepared = JSON.parse(text(4)) as { ref: string; prompt: string }[];
    expect(prepared.map((p) => p.ref)).toEqual(['room#INV-1']);
    expect(prepared[0]!.prompt).toContain('if (false)');
    expect(text(5)).toBe('Lore-Ack: room#INV-1');
    expect(replies[6]!.error!.code).toBe(-32602);
    expect(replies[7]!.error!.code).toBe(-32601);
  });
});
