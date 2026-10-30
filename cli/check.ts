/**
 * Applies SPEC.md §10 lint rules and §7 trust tiers to a loaded repository.
 */
// @lore enforces contracts#INV-1
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { type Repo, type Node, type Claim, CLAIM_TYPES, SECTION_TYPE, VERBS, parseRef, isTestFile } from './parse'

export type Level = 'error' | 'warn' | 'info'

export interface Finding {
  code: string
  level: Level
  file: string
  line: number
  message: string
}

export type Tier = 'tested' | 'anchored' | 'asserted'

export interface TierReport {
  claim: string // node#ID
  tier: Tier
}

export interface CheckResult {
  findings: Finding[]
  tiers: TierReport[]
  counts: { nodes: number; claims: number; markers: number }
}

const LEVEL: Record<string, Level> = {
  L001: 'error', L002: 'error', L003: 'error', L004: 'error', L005: 'error', L006: 'error',
  L007: 'warn', L008: 'warn', L009: 'warn', L010: 'warn', L011: 'warn', L012: 'warn',
  L013: 'info', L014: 'info',
}
const SCOPES = new Set(['app', 'domain', 'feature', 'edge'])
const ORDER = ['invariants', 'decisions', 'edges', 'limits', 'quirks', 'plans']
const TIERED = new Set(['INV', 'EDGE', 'LIM', 'QRK'])

export function check(repo: Repo, today: Date = new Date()): CheckResult {
  const findings: Finding[] = []
  // @lore enforces contracts#INV-2
  const add = (code: string, file: string, line: number, message: string) =>
    findings.push({ code, level: LEVEL[code], file, line, message })

  const claimIndex = new Map<string, Claim>()
  for (const node of repo.nodes.values()) for (const c of node.claims) claimIndex.set(`${node.id.toLowerCase()}#${c.id}`, c)

  const nodeByPath = new Map<string, Node>()
  for (const node of repo.nodes.values()) nodeByPath.set(normalize(node.file), node)

  // Markers first: they feed L009 and the trust tiers.
  const anchored = new Map<string, { verb: string; file: string }[]>()
  const markedNodes = new Set<string>()
  for (const m of repo.markers) {
    if (!(VERBS as readonly string[]).includes(m.verb)) add('L006', m.file, m.line, `unknown marker verb "${m.verb}"`)
    for (const r of m.refs) {
      if (!r.includes('#') && /^(INV|DEC|EDGE|LIM|QRK|PLAN)-\d+$/i.test(r)) {
        add('L006', m.file, m.line, `marker uses local reference "${r}"; write node#${r.toUpperCase()}`)
        continue
      }
      const p = parseRef(r)
      if (!p) {
        add('L006', m.file, m.line, `marker reference "${r}" is not a valid reference`)
        continue
      }
      if (!repo.nodes.has(p.node)) {
        add('L001', m.file, m.line, `marker points at missing node "${p.node}"`)
        continue
      }
      markedNodes.add(p.node)
      if (p.claim) {
        const key = `${p.node}#${p.claim}`
        if (!claimIndex.has(key)) add('L001', m.file, m.line, `marker points at missing claim ${key}`)
        else anchored.set(key, [...(anchored.get(key) ?? []), { verb: m.verb, file: m.file }])
      }
    }
  }

  for (const node of repo.nodes.values()) {
    const nid = node.id.toLowerCase()
    const f = node.front
    if (node.frontError) add('L004', node.file, 1, node.frontError)
    if (!/^[a-z][a-z0-9-]*$/.test(node.id)) add('L004', node.file, 1, `node ID "${node.id}" must match [a-z][a-z0-9-]*`)

    // L004 required frontmatter
    if (!node.frontError) {
      if (typeof f.scope !== 'string' || !SCOPES.has(f.scope)) add('L004', node.file, 1, 'missing or invalid `scope` (app | domain | feature | edge)')
      if (typeof f.summary !== 'string' || !f.summary.trim()) add('L004', node.file, 1, 'missing `summary`')
      if (nid === 'app' && typeof f.spec !== 'string') add('L004', node.file, 1, 'APP.md needs `spec: lore/<version>`')
    }

    // L005 parent tree
    if (nid !== 'app' && !node.frontError) {
      const seen = new Set<string>([nid])
      let cur: unknown = f.parent
      let ok = false
      while (true) {
        if (typeof cur !== 'string' || !cur) { add('L005', node.file, 1, '`parent` is missing'); break }
        const p = cur.toLowerCase()
        if (p === 'app') { ok = true; break }
        if (!repo.nodes.has(p)) { add('L005', node.file, 1, `parent "${p}" does not exist`); break }
        if (seen.has(p)) { add('L005', node.file, 1, `parent chain has a cycle through "${p}"`); break }
        seen.add(p)
        cur = repo.nodes.get(p)!.front.parent
      }
      void ok
    }

    // Claims
    const ids = new Set<string>()
    for (const c of node.claims) {
      if (ids.has(c.id)) add('L002', node.file, c.line, `duplicate claim ${c.id}`)
      ids.add(c.id)
      const expected = c.section ? SECTION_TYPE[c.section] : undefined
      if (expected !== c.type) {
        const where = c.section ? `"## ${c.section}"` : 'no claim section'
        add('L003', node.file, c.line, `${c.id} sits under ${where}; ${c.type} claims belong under "## ${sectionName(c.type)}"`)
      }
      if (c.headingExtra) add('L012', node.file, c.line, `heading for ${c.id} has extra text "${c.headingExtra}"`)
      const words = c.statement.split(/\s+/).filter(Boolean).length
      if (words > 30) add('L011', node.file, c.line, `${c.id} first paragraph is ${words} words (max 30)`)
      if (c.type === 'PLAN' && !c.meta.review_after && (c.meta.status ?? 'active') === 'active') add('L007', node.file, c.line, `${c.id} has no review_after`)
      if (c.type === 'DEC' && !c.body.some((l) => /^\s*Rejected:/.test(l))) add('L013', node.file, c.line, `${c.id} has no "Rejected:" line`)
      if (c.meta.review_after) {
        const due = dueDate(c.meta.review_after, f.verified)
        if (due && due < today && (c.meta.status ?? 'active') === 'active') add('L008', node.file, c.line, `${c.id} review_after passed (${iso(due)})`)
      }
    }

    // Node-level review
    if (f.review_after !== undefined) {
      const due = dueDate(String(f.review_after), f.verified)
      if (due && due < today) add('L008', node.file, 1, `review_after passed (${iso(due)})`)
    }
    const hasCovers = Array.isArray(f.covers) && f.covers.length > 0
    if (!hasCovers && !markedNodes.has(nid) && f.review_after === undefined) add('L009', node.file, 1, 'no `covers`, no markers point here, and no `review_after`')
    if (node.lines.length > 300) add('L010', node.file, 1, `${node.lines.length} lines (max 300)`)

    // L014 section order
    const order = node.sections.map((s) => ORDER.indexOf(s))
    if (order.some((v, i) => i > 0 && v < order[i - 1])) add('L014', node.file, 1, 'claim sections are out of the recommended order')

    // L001 references
    for (const r of node.refs) {
      if (r.kind === 'link') {
        const target = r.node.slice('@path:'.length)
        const linked = nodeByPath.get(normalize(target))
        if (!linked) {
          if (!existsSync(join(repo.root, target))) add('L001', node.file, r.line, `link to missing file "${r.raw}"`)
          continue
        }
        if (r.claim && !linked.claims.some((c) => c.id === r.claim)) add('L001', node.file, r.line, `link "${r.raw}" points at missing claim ${linked.id}#${r.claim}`)
        continue
      }
      if (!repo.nodes.has(r.node)) {
        add('L001', node.file, r.line, `reference to missing node "${r.node}" (${r.raw})`)
        continue
      }
      if (r.claim && !claimIndex.has(`${r.node}#${r.claim}`)) add('L001', node.file, r.line, `reference to missing claim ${r.node}#${r.claim}`)
    }
  }

  // §7 trust tiers
  const tiers: TierReport[] = []
  for (const node of repo.nodes.values()) {
    for (const c of node.claims) {
      if (!TIERED.has(c.type) || (c.meta.status ?? 'active') !== 'active') continue
      const key = `${node.id.toLowerCase()}#${c.id}`
      const marks = anchored.get(key) ?? []
      const testPaths = (c.meta.tests ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const tested =
        testPaths.some((p) => existsSync(join(repo.root, p))) ||
        marks.some((m) => m.verb === 'enforces' && isTestFile(m.file))
      const tier: Tier = tested ? 'tested' : marks.some((m) => m.verb === 'enforces' || m.verb === 'implements') ? 'anchored' : 'asserted'
      tiers.push({ claim: key, tier })
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code))
  const claims = [...repo.nodes.values()].reduce((n, node) => n + node.claims.length, 0)
  return { findings, tiers, counts: { nodes: repo.nodes.size, claims, markers: repo.markers.length } }
}

function sectionName(type: string): string {
  const name = Object.entries(SECTION_TYPE).find(([, t]) => t === type)?.[0] ?? 'unknown'
  return name[0].toUpperCase() + name.slice(1)
}

/** `review_after` is a date, or a duration like `90d` counted from `verified`. */
export function dueDate(value: string, verified: unknown): Date | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`)
  const d = /^(\d+)d$/.exec(v)
  if (!d) return null
  const base = verified instanceof Date ? verified : typeof verified === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(verified) ? new Date(`${verified}T00:00:00Z`) : null
  if (!base) return null
  return new Date(base.getTime() + Number(d[1]) * 86_400_000)
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export { CLAIM_TYPES }
