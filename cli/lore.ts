#!/usr/bin/env bun
/**
 * lore — command-line tools for Lore repositories (SPEC.md §11, level L2).
 *
 *   bun cli/lore.ts check [dir] [--json] [--strict] [--quiet] [--today=YYYY-MM-DD]
 *
 * Exit codes: 0 clean, 1 errors (or warnings with --strict), 2 usage.
 */
import { loadRepo } from './parse'
import { check, type Finding } from './check'

const USAGE = `usage: lore check [dir] [--json] [--strict] [--quiet] [--today=YYYY-MM-DD]

  --json     print findings and trust tiers as JSON
  --strict   exit 1 on warnings too
  --quiet    only print errors and warnings
  --today    evaluate review dates as of this day (for reproducible runs)`

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  if (cmd !== 'check') {
    console.error(USAGE)
    return cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 2
  }
  const flags = new Set(rest.filter((a) => a.startsWith('--') && !a.includes('=')))
  const today = rest.find((a) => a.startsWith('--today='))?.split('=')[1]
  const dir = rest.find((a) => !a.startsWith('--')) ?? '.'
  for (const f of flags) if (!['--json', '--strict', '--quiet'].includes(f)) return usage(`unknown flag ${f}`)
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return usage('--today must be YYYY-MM-DD')

  const repo = loadRepo(dir)
  if (repo.nodes.size === 0) {
    console.error(`no Lore graph found in ${repo.root} (expected APP.md and ${repo.dir}/)`)
    return 1
  }
  const result = check(repo, today ? new Date(`${today}T00:00:00Z`) : new Date())
  const errors = result.findings.filter((f) => f.level === 'error').length
  const warnings = result.findings.filter((f) => f.level === 'warn').length

  if (flags.has('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    print(result.findings, flags.has('--quiet'))
    const t = { tested: 0, anchored: 0, asserted: 0 }
    for (const r of result.tiers) t[r.tier]++
    const c = result.counts
    console.log(`\n${c.nodes} nodes · ${c.claims} claims · ${c.markers} markers`)
    console.log(`trust: ${t.tested} tested · ${t.anchored} anchored · ${t.asserted} asserted`)
    const asserted = result.tiers.filter((r) => r.tier === 'asserted').map((r) => r.claim)
    if (asserted.length && !flags.has('--quiet')) console.log(`asserted only: ${asserted.join(', ')}`)
    const infos = result.findings.length - errors - warnings
    console.log(`${errors} errors · ${warnings} warnings · ${infos} info`)
  }
  return errors > 0 || (flags.has('--strict') && warnings > 0) ? 1 : 0
}

function print(findings: Finding[], quiet: boolean) {
  for (const f of findings) {
    if (quiet && f.level === 'info') continue
    console.log(`${f.level.padEnd(5)} ${f.code} ${f.file}:${f.line}  ${f.message}`)
  }
}

function usage(message: string): number {
  console.error(`${message}\n\n${USAGE}`)
  return 2
}

process.exit(main(process.argv.slice(2)))
