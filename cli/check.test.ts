// @lore enforces contracts#INV-1, contracts#INV-2
import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { loadRepo } from './parse'
import { check, dueDate } from './check'

// Built by concatenation so this file isn't scanned as containing real markers.
const AT = '@' + 'lore'
const TODAY = new Date('2026-10-30T00:00:00Z')

const APP = `---
spec: lore/0.1
scope: app
summary: Test app.
covers: [src/**]
---

# App
`

function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'lore-'))
  for (const [path, text] of Object.entries({ 'APP.md': APP, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return check(loadRepo(root), TODAY)
}

function node(front: string, body: string) {
  return `---\n${front}\n---\n\n# Node\n\n${body}\n`
}

const BASE = 'scope: domain\nparent: app\nsummary: A node.\ncovers: [src/**]'
const codes = (r: ReturnType<typeof repo>) => r.findings.map((f) => f.code)

test('a clean graph has no findings', () => {
  const r = repo({
    'docs/auth.md': node(BASE, '## Invariants\n\n### INV-1\nTokens expire.\n\n## Decisions\n\n### DEC-1\nUse opaque tokens.\n\nRejected: JWT for sessions.'),
    'src/a.ts': `// ${AT} enforces auth#INV-1\nexport const x = 1\n`,
  })
  expect(r.findings).toEqual([])
  expect(r.tiers).toEqual([{ claim: 'auth#INV-1', tier: 'anchored' }])
})

test('L001: references to missing nodes, claims and link targets', () => {
  const r = repo({
    'docs/auth.md': node(BASE, '## Invariants\n\n### INV-1\nSee billing#INV-1 and INV-9 and [x](auth.md#inv-4) and [y](nope.md).'),
    'src/a.ts': `// ${AT} enforces ghost#INV-1\n`,
  })
  expect(codes(r).filter((c) => c === 'L001').length).toBe(5)
})

test('L001: a root link without the docs/ prefix is caught', () => {
  const r = repo({
    'APP.md': APP + '\nSee [auth#INV-1](auth.md#inv-1).\n',
    'docs/auth.md': node(BASE, '## Invariants\n\n### INV-1\nTokens expire.'),
  })
  expect(r.findings.some((f) => f.code === 'L001' && f.file === 'APP.md')).toBe(true)
})

test('L002, L003, L012: duplicates, wrong section, titled heading', () => {
  const r = repo({
    'docs/auth.md': node(BASE, '## Invariants\n\n### INV-1\nA.\n\n### INV-1\nB.\n\n### DEC-1 Use tokens\nC.\n\nRejected: none.'),
  })
  expect(codes(r)).toEqual(expect.arrayContaining(['L002', 'L003', 'L012']))
})

test('L004 and L005: frontmatter and parent tree', () => {
  const r = repo({
    'docs/a.md': node('scope: domain\nparent: b\nsummary: A.\ncovers: [x]', ''),
    'docs/b.md': node('scope: domain\nparent: a\nsummary: B.\ncovers: [x]', ''),
    'docs/c.md': node('scope: nope\nparent: app\ncovers: [x]', ''),
  })
  expect(codes(r).filter((c) => c === 'L005').length).toBe(2)
  expect(codes(r).filter((c) => c === 'L004').length).toBe(2)
})

test('L006: unknown verbs and local references in markers', () => {
  const r = repo({
    'docs/auth.md': node(BASE, '## Invariants\n\n### INV-1\nA.'),
    'src/a.ts': `// ${AT} guarantees auth#INV-1\n// ${AT} enforces INV-1\n`,
  })
  expect(codes(r).filter((c) => c === 'L006').length).toBe(2)
})

test('markers inside fenced or inline code in markdown are ignored', () => {
  const r = repo({
    'README.md': `\`\`\`ts\n// ${AT} enforces ghost#INV-1\n\`\`\`\n\nInline: \`<!-- ${AT} enforces ghost#INV-2 -->\`\n`,
  })
  expect(r.findings).toEqual([])
  expect(r.counts.markers).toBe(0)
})

test('L007, L008, L009: plans, review dates, unanchored nodes', () => {
  const r = repo({
    'docs/a.md': node('scope: domain\nparent: app\nsummary: A.\nverified: 2026-01-01\nreview_after: 90d', '## Plans\n\n### PLAN-1\nDo it.\n\n### PLAN-2\nLater.\n\n- review_after: 2026-02-01'),
    'docs/b.md': node('scope: domain\nparent: app\nsummary: B.', ''),
  })
  expect(codes(r)).toEqual(expect.arrayContaining(['L007', 'L008', 'L009']))
  expect(codes(r).filter((c) => c === 'L008').length).toBe(2)
})

test('L011 and L013: long statements, decisions without Rejected', () => {
  const long = Array.from({ length: 31 }, (_, i) => `w${i}`).join(' ')
  const r = repo({
    'docs/a.md': node(BASE, `## Invariants\n\n### INV-1\n${long}\n\n## Decisions\n\n### DEC-1\nPick one.`),
  })
  expect(codes(r)).toEqual(expect.arrayContaining(['L011', 'L013']))
})

test('L014: sections out of order', () => {
  const r = repo({
    'docs/a.md': node(BASE, '## Decisions\n\n### DEC-1\nX.\n\nRejected: Y.\n\n## Invariants\n\n### INV-1\nZ.'),
  })
  expect(codes(r)).toContain('L014')
})

test('trust tiers: tested beats anchored beats asserted; retired claims are skipped', () => {
  const r = repo({
    'docs/a.md': node(BASE, '## Invariants\n\n### INV-1\nT.\n\n- tests: tests/a.test.ts\n\n### INV-2\nA.\n\n### INV-3\nP.\n\n### INV-4\nOld.\n\n- status: retired\n\n## Limits\n\n### LIM-1\nE.'),
    'tests/a.test.ts': '// test\n',
    'src/a.ts': `// ${AT} implements a#INV-2\n`,
    'src/b.test.ts': `// ${AT} enforces a#LIM-1\n`,
  })
  expect(Object.fromEntries(r.tiers.map((t) => [t.claim, t.tier]))).toEqual({
    'a#INV-1': 'tested',
    'a#INV-2': 'anchored',
    'a#INV-3': 'asserted',
    'a#LIM-1': 'tested',
  })
})

test('dueDate handles dates and durations', () => {
  expect(dueDate('2027-01-15', undefined)?.toISOString().slice(0, 10)).toBe('2027-01-15')
  expect(dueDate('90d', '2026-10-15')?.toISOString().slice(0, 10)).toBe('2027-01-13')
  expect(dueDate('90d', undefined)).toBeNull()
})
