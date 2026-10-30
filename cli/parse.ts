/**
 * Reads a Lore repository: nodes, claims, references and markers (SPEC.md §2–§5).
 * Pure parsing; no rules are applied here.
 */
// @lore enforces contracts#INV-1
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname, dirname, resolve } from 'node:path'

export const CLAIM_TYPES = ['INV', 'DEC', 'EDGE', 'LIM', 'QRK', 'PLAN'] as const
export type ClaimType = (typeof CLAIM_TYPES)[number]

export const SECTION_TYPE: Record<string, ClaimType> = {
  invariants: 'INV',
  decisions: 'DEC',
  edges: 'EDGE',
  limits: 'LIM',
  quirks: 'QRK',
  plans: 'PLAN',
}

export const VERBS = ['enforces', 'implements', 'see'] as const
export type Verb = (typeof VERBS)[number]

export interface Claim {
  node: string
  id: string // e.g. INV-1, uppercase
  type: ClaimType
  section: string | null // lowercased `##` heading the claim sits under
  line: number
  headingExtra: string // text after the ID in the heading (L012)
  statement: string // first paragraph
  meta: Record<string, string>
  body: string[]
}

export interface Ref {
  file: string
  line: number
  node: string // lowercased node ID
  claim: string | null // uppercase claim ID, or null for a node-only link
  raw: string
  kind: 'full' | 'local' | 'link' | 'meta' | 'frontmatter'
}

export interface Node {
  id: string
  file: string // repo-relative path
  front: Record<string, unknown>
  frontError: string | null
  lines: string[]
  claims: Claim[]
  sections: string[] // claim sections in order of appearance
  refs: Ref[]
}

export interface Marker {
  file: string
  line: number
  verb: string
  refs: string[]
  raw: string
}

export interface Repo {
  root: string
  dir: string
  nodes: Map<string, Node>
  markers: Marker[]
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.lore', 'dist', 'build', 'coverage'])
const FULL_REF = /\b([a-z][a-z0-9-]*)#((?:INV|DEC|EDGE|LIM|QRK|PLAN)-\d+)\b/gi
const LOCAL_REF = /(?<![#\w-])((?:INV|DEC|EDGE|LIM|QRK|PLAN)-\d+)\b/g
const MD_LINK = /\]\(([^)\s]+\.md)(#[^)\s]*)?\)/g
const CLAIM_HEADING = /^###\s+((?:INV|DEC|EDGE|LIM|QRK|PLAN)-\d+)\b(.*)$/i
const MARKER = /@lore\s+([A-Za-z_-]+)\s+([^\n]*?)(?:-->|\*\/|$)/

export function loadRepo(root: string): Repo {
  root = resolve(root)
  const dir = readConfigDir(root)
  const nodes = new Map<string, Node>()
  const app = join(root, 'APP.md')
  if (existsSync(app)) nodes.set('app', parseNode(root, app, 'app'))
  const nodeDir = join(root, dir)
  if (existsSync(nodeDir)) {
    for (const name of readdirSync(nodeDir).sort()) {
      const full = join(nodeDir, name)
      if (!name.endsWith('.md') || name.startsWith('_') || !statSync(full).isFile()) continue
      const id = name.slice(0, -3)
      nodes.set(id.toLowerCase(), parseNode(root, full, id))
    }
  }
  return { root, dir, nodes, markers: scanMarkers(root) }
}

function readConfigDir(root: string): string {
  const path = join(root, '.lore', 'config.json')
  if (!existsSync(path)) return 'docs'
  try {
    const dir = JSON.parse(readFileSync(path, 'utf8')).dir
    return typeof dir === 'string' && dir ? dir : 'docs'
  } catch {
    return 'docs'
  }
}

/** Splits `---` frontmatter from the body. Returns body start line (0-based). */
export function splitFrontmatter(text: string): { front: Record<string, unknown>; error: string | null; bodyStart: number } {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { front: {}, error: 'missing frontmatter', bodyStart: 0 }
  const end = lines.indexOf('---', 1)
  if (end === -1) return { front: {}, error: 'unterminated frontmatter', bodyStart: 0 }
  try {
    const parsed = Bun.YAML.parse(lines.slice(1, end).join('\n'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { front: {}, error: 'frontmatter is not a map', bodyStart: end + 1 }
    return { front: parsed as Record<string, unknown>, error: null, bodyStart: end + 1 }
  } catch (e) {
    return { front: {}, error: `invalid frontmatter: ${(e as Error).message}`, bodyStart: end + 1 }
  }
}

/** Replaces inline code spans with spaces so their contents are never parsed. */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
}

function parseNode(root: string, path: string, id: string): Node {
  const text = readFileSync(path, 'utf8')
  const file = relative(root, path)
  const { front, error, bodyStart } = splitFrontmatter(text)
  const lines = text.split('\n')
  const node: Node = { id, file, front, frontError: error, lines, claims: [], sections: [], refs: [] }

  let fence = false
  let section: string | null = null
  let claim: Claim | null = null
  let inStatement = false

  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i]
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) continue

    const h2 = /^##\s+(.+?)\s*$/.exec(raw)
    if (h2 && !raw.startsWith('###')) {
      section = h2[1].toLowerCase()
      if (SECTION_TYPE[section] && !node.sections.includes(section)) node.sections.push(section)
      claim = null
      continue
    }
    const h3 = CLAIM_HEADING.exec(raw)
    if (h3) {
      const cid = h3[1].toUpperCase()
      claim = {
        node: id,
        id: cid,
        type: cid.split('-')[0] as ClaimType,
        section,
        line: i + 1,
        headingExtra: h3[2].trim(),
        statement: '',
        meta: {},
        body: [],
      }
      node.claims.push(claim)
      inStatement = true
      continue
    }
    if (/^#{1,3}\s/.test(raw)) {
      claim = null
      continue
    }

    if (claim) {
      claim.body.push(raw)
      if (inStatement) {
        if (raw.trim() === '') {
          if (claim.statement) inStatement = false
        } else {
          claim.statement += (claim.statement ? ' ' : '') + raw.trim()
        }
      }
      const meta = /^-\s+([a-z_]+):\s*(.+?)\s*$/.exec(raw)
      if (meta) {
        claim.meta[meta[1]] = meta[2]
        if (meta[1] === 'superseded_by') pushRefs(node, meta[2], i + 1, 'meta')
      }
    }

    const text = stripInlineCode(raw).replace(/<!--[\s\S]*?-->/g, '')
    collectRefs(node, text, i + 1, dirname(path), root)
  }

  // links: [{ to: node }] in frontmatter
  const links = Array.isArray(front.links) ? front.links : []
  for (const link of links) {
    if (link && typeof link === 'object' && typeof (link as any).to === 'string') {
      node.refs.push({ file, line: 1, node: (link as any).to.toLowerCase(), claim: null, raw: `links: ${(link as any).to}`, kind: 'frontmatter' })
    }
  }
  if (typeof front.parent === 'string') {
    // parent is checked separately (L005), not as a reference
  }
  return node
}

function pushRefs(node: Node, text: string, line: number, kind: Ref['kind']) {
  for (const m of text.matchAll(FULL_REF)) {
    node.refs.push({ file: node.file, line, node: m[1].toLowerCase(), claim: m[2].toUpperCase(), raw: m[0], kind })
  }
}

function collectRefs(node: Node, text: string, line: number, fileDir: string, root: string) {
  const masked = text.replace(MD_LINK, (m) => ' '.repeat(m.length))
  for (const m of masked.matchAll(FULL_REF)) {
    node.refs.push({ file: node.file, line, node: m[1].toLowerCase(), claim: m[2].toUpperCase(), raw: m[0], kind: 'full' })
  }
  const withoutFull = masked.replace(FULL_REF, (m) => ' '.repeat(m.length))
  for (const m of withoutFull.matchAll(LOCAL_REF)) {
    node.refs.push({ file: node.file, line, node: node.id.toLowerCase(), claim: m[1].toUpperCase(), raw: m[1], kind: 'local' })
  }
  for (const m of text.matchAll(MD_LINK)) {
    const target = m[1]
    if (/^[a-z]+:/i.test(target)) continue // external URL
    const abs = resolve(fileDir, target)
    const anchor = m[2]?.slice(1) ?? ''
    const claimMatch = /^((?:inv|dec|edge|lim|qrk|plan)-\d+)$/i.exec(anchor)
    node.refs.push({
      file: node.file,
      line,
      node: '@path:' + relative(root, abs),
      claim: claimMatch ? claimMatch[1].toUpperCase() : null,
      raw: m[0].slice(2, -1),
      kind: 'link',
    })
  }
}

function listFiles(root: string): string[] {
  const proc = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard'], { cwd: root, stderr: 'ignore' })
  if (proc.exitCode === 0) {
    return proc.stdout.toString().split('\n').filter(Boolean).filter((f) => !f.split('/').some((p) => SKIP_DIRS.has(p)))
  }
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else out.push(relative(root, full))
    }
  }
  walk(root)
  return out.sort()
}

/** Finds `@lore` markers in every tracked file (SPEC.md §5). */
export function scanMarkers(root: string): Marker[] {
  const markers: Marker[] = []
  for (const file of listFiles(root)) {
    const full = join(root, file)
    if (!existsSync(full) || statSync(full).size > 2_000_000) continue
    const text = readFileSync(full, 'utf8')
    if (text.includes('\u0000') || !text.includes('@lore')) continue
    const isMd = extname(file).toLowerCase() === '.md'
    let fence = false
    text.split('\n').forEach((raw, i) => {
      if (isMd && /^\s*(```|~~~)/.test(raw)) {
        fence = !fence
        return
      }
      if (fence) return
      const sources = isMd ? [...stripInlineCode(raw).matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]) : [raw]
      for (const source of sources) {
        const m = MARKER.exec(source)
        if (!m) continue
        const refs = m[2].split(',').map((r) => r.trim()).filter(Boolean)
        markers.push({ file, line: i + 1, verb: m[1], refs, raw: m[0].trim() })
      }
    })
  }
  return markers
}

/** Parses a reference string like `node#INV-1` or `node`. */
export function parseRef(ref: string): { node: string; claim: string | null } | null {
  const m = /^([a-z][a-z0-9-]*)(?:#((?:INV|DEC|EDGE|LIM|QRK|PLAN)-\d+))?$/i.exec(ref.trim())
  return m ? { node: m[1].toLowerCase(), claim: m[2]?.toUpperCase() ?? null } : null
}

export function isTestFile(file: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(file) || /\.(test|spec)\.[a-z]+$/i.test(file)
}
