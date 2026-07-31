#!/usr/bin/env node
// Build ONE testrun.openape.ai manifest from the vitest JSON reports of the
// e2e CI suites, so every e2e run gets a public proof link (or at least a
// downloadable artifact).
//
//   node scripts/e2e-manifest.mjs --out /tmp/e2e-run [--sha <sha>] [--run-url <url>] \
//     core=/tmp/e2e-report-core.json testrun=/tmp/e2e-report-testrun.json …
//
// Each positional is `<suite-name>=<vitest-json-report>`. A MISSING report
// file is expected CI reality (a failed step aborts the later suites) and
// becomes an explicit "skipped" entry — a PRESENT but unreadable/malformed
// report is a hard error, never silently papered over.
//
// Retry visibility: vitest's JSON reporter carries no retry counter, but a
// test that PASSED with non-empty `failureMessages` passed only on a retry
// (earlier attempts append their errors). Those tests are marked flaky in
// both the step caption and the run summary, so retries stay visible
// instead of being masked by the eventual green.
//
// The output shape mirrors the server-side validator in
// apps/openape-testrun/server/utils/run-shape.ts (RunManifest) including its
// limits — exceeding them here throws instead of shipping an invalid upload.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const MAX_TESTS = 200
const MAX_STEPS_PER_TEST = 100
const MAX_TEXT = 20_000
const MAX_TITLE = 300

function truncate(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, max - 2)} …`
}

function stepStatus(assertion) {
  if (assertion.status === 'passed') return 'passed'
  if (assertion.status === 'failed') return 'failed'
  return 'skipped'
}

/** Human count for retries inferred from accumulated failure messages. */
function retryCaption(attemptsFailed) {
  return `Flaky: passed only after ${attemptsFailed} failed attempt${attemptsFailed === 1 ? '' : 's'} (vitest retry).`
}

function suiteFileEntries(suiteName, report, flakyTitles) {
  if (!Array.isArray(report.testResults)) {
    throw new TypeError(`suite "${suiteName}": unexpected report shape — no testResults array (not a vitest --reporter=json output?)`)
  }
  const entries = []
  for (const fileResult of report.testResults) {
    if (!Array.isArray(fileResult.assertionResults)) {
      throw new TypeError(`suite "${suiteName}": unexpected report shape — testResults entry without assertionResults array`)
    }
    const fileName = typeof fileResult.name === 'string' && fileResult.name.length > 0
      ? relative(process.cwd(), fileResult.name)
      : '(unknown file)'

    const steps = []
    const errors = []
    for (const assertion of fileResult.assertionResults) {
      const status = stepStatus(assertion)
      const failures = Array.isArray(assertion.failureMessages) ? assertion.failureMessages : []
      const retried = status === 'passed' && failures.length > 0
      if (retried) flakyTitles.push(`${suiteName} · ${assertion.fullName}`)
      steps.push({
        title: truncate(String(assertion.fullName ?? assertion.title ?? '(untitled)'), MAX_TITLE),
        status,
        ...(retried ? { caption: retryCaption(failures.length) } : {}),
      })
      if (status === 'failed' && failures.length > 0) {
        errors.push(`**${assertion.fullName}**\n\n\`\`\`\n${truncate(failures[0], 4000)}\n\`\`\``)
      }
    }

    const failed = steps.some(s => s.status === 'failed')
    const passed = steps.some(s => s.status === 'passed')
    const status = failed ? 'failed' : passed ? 'passed' : 'skipped'
    const error = errors.length > 0 ? truncate(errors.join('\n\n'), MAX_TEXT) : undefined

    // The server caps steps per test — split oversized files into chunks
    // rather than dropping steps.
    for (let chunk = 0; chunk * MAX_STEPS_PER_TEST < Math.max(steps.length, 1); chunk++) {
      const suffix = chunk === 0 ? '' : ` (${chunk + 1})`
      entries.push({
        id: truncate(`${suiteName}:${fileName}${suffix}`, 200),
        title: truncate(`${suiteName} · ${fileName}${suffix}`, MAX_TITLE),
        status,
        ...(error && chunk === 0 ? { error } : {}),
        steps: steps.slice(chunk * MAX_STEPS_PER_TEST, (chunk + 1) * MAX_STEPS_PER_TEST),
      })
    }
  }
  return entries
}

function countByStatus(entries) {
  const steps = entries.flatMap(e => e.steps)
  return {
    passed: steps.filter(s => s.status === 'passed').length,
    failed: steps.filter(s => s.status === 'failed').length,
    skipped: steps.filter(s => s.status === 'skipped').length,
  }
}

/**
 * Build the RunManifest from parsed suite reports.
 *
 * `suites` is `[{ name, report }]` where `report` is the parsed vitest JSON
 * report or `null` when the suite wrote none (did not run / crashed).
 */
export function buildManifest(suites, { sha, runUrl } = {}) {
  if (!Array.isArray(suites) || suites.length === 0) {
    throw new Error('no suites given')
  }
  if (suites.every(s => s.report === null)) {
    throw new Error('no suite produced a JSON report — nothing to publish (did every step fail before vitest ran?)')
  }

  const flakyTitles = []
  const tests = []
  const summaryLines = []
  let startMs = Number.POSITIVE_INFINITY
  let endMs = 0

  for (const { name, report } of suites) {
    if (report === null) {
      tests.push({
        id: `${name}:no-report`,
        title: `${name} · no report produced`,
        status: 'skipped',
        description: 'The suite wrote no JSON report — it either did not run (an earlier CI step failed) or crashed before the reporter flushed.',
        steps: [],
      })
      summaryLines.push(`- **${name}**: no report (not run or crashed)`)
      continue
    }
    const entries = suiteFileEntries(name, report, flakyTitles)
    tests.push(...entries)
    const { passed, failed, skipped } = countByStatus(entries)
    summaryLines.push(`- **${name}**: ${passed} passed, ${failed} failed, ${skipped} skipped`)
    if (Number.isFinite(report.startTime)) startMs = Math.min(startMs, report.startTime)
    for (const fileResult of report.testResults) {
      if (Number.isFinite(fileResult.endTime)) endMs = Math.max(endMs, fileResult.endTime)
    }
  }

  if (tests.length > MAX_TESTS) {
    throw new Error(`manifest would contain ${tests.length} test entries — over the server cap of ${MAX_TESTS}; shard the report before uploading`)
  }

  const summaryParts = []
  if (sha) summaryParts.push(`Commit \`${sha}\`${runUrl ? ` — [CI run](${runUrl})` : ''}`)
  summaryParts.push(summaryLines.join('\n'))
  if (flakyTitles.length > 0) {
    summaryParts.push(`**Flaky — passed only after retry:**\n${flakyTitles.map(t => `- ${t}`).join('\n')}`)
  }

  const startedAt = Number.isFinite(startMs) && startMs !== Number.POSITIVE_INFINITY ? new Date(startMs).toISOString() : undefined
  const finishedAt = endMs > 0 ? new Date(endMs).toISOString() : undefined
  const day = (startedAt ?? new Date().toISOString()).slice(0, 10)

  return {
    title: `E2E ${day} · ${sha ? sha.slice(0, 7) : 'local'}`,
    project: 'openape',
    summary: truncate(summaryParts.join('\n\n'), MAX_TEXT),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    tests,
  }
}

function parseArgs(argv) {
  const spec = { out: undefined, sha: undefined, runUrl: undefined, suites: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out') {
      spec.out = argv[++i]
    }
    else if (arg === '--sha') {
      spec.sha = argv[++i]
    }
    else if (arg === '--run-url') {
      spec.runUrl = argv[++i]
    }
    else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`)
    }
    else {
      const eq = arg.indexOf('=')
      if (eq < 1) throw new Error(`suite argument must be <name>=<report-file>, got "${arg}"`)
      spec.suites.push({ name: arg.slice(0, eq), file: arg.slice(eq + 1) })
    }
  }
  if (!spec.out) throw new Error('--out <dir> is required')
  if (spec.suites.length === 0) throw new Error('at least one <name>=<report-file> argument is required')
  return spec
}

function main() {
  const spec = parseArgs(process.argv.slice(2))
  const suites = spec.suites.map(({ name, file }) => {
    if (!existsSync(file)) {
      console.error(`[e2e-manifest] suite "${name}": ${file} missing — recorded as skipped`)
      return { name, report: null }
    }
    let report
    try {
      report = JSON.parse(readFileSync(file, 'utf8'))
    }
    catch (err) {
      throw new Error(`suite "${name}": ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
    return { name, report }
  })

  const manifest = buildManifest(suites, { sha: spec.sha, runUrl: spec.runUrl })
  mkdirSync(spec.out, { recursive: true })
  const outFile = join(spec.out, 'testrun.json')
  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.error(`[e2e-manifest] ${manifest.tests.length} test entr${manifest.tests.length === 1 ? 'y' : 'ies'} → ${outFile}`)
  console.log(outFile)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  }
  catch (err) {
    console.error(`[e2e-manifest] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
