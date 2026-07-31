// Sanity tests for scripts/e2e-manifest.mjs — run with:
//   node --test scripts/e2e-manifest.test.mjs
// The e2e CI workflow runs this right before building the real manifest, so
// a broken mapping fails loudly instead of shipping a wrong proof link.

import assert from 'node:assert/strict'
// node:test on purpose (not vitest): the CI step runs this dependency-free
// via `node --test`, before any workspace tooling is involved.
// eslint-disable-next-line test/no-import-node-test
import { test } from 'node:test'
import { buildManifest } from './e2e-manifest.mjs'

function vitestReport(testResults, startTime = 1_700_000_000_000) {
  return { startTime, testResults }
}

function fileResult(name, assertions, endTime = 1_700_000_100_000) {
  return { name, endTime, status: assertions.some(a => a.status === 'failed') ? 'failed' : 'passed', assertionResults: assertions }
}

const passing = { fullName: 'logs in', status: 'passed', failureMessages: [] }
const failing = { fullName: 'rejects bad token', status: 'failed', failureMessages: ['Error: expected 401', 'Error: expected 401'] }
const skipped = { fullName: 'todo case', status: 'skipped', failureMessages: [] }
const retried = { fullName: 'boots the dev server', status: 'passed', failureMessages: ['Error: boot timeout'] }

test('maps files to test entries and assertions to steps', () => {
  const manifest = buildManifest(
    [{ name: 'core', report: vitestReport([fileResult('/repo/examples/e2e/tests/login.test.ts', [passing, failing, skipped])]) }],
    { sha: 'abcdef1234567890' },
  )
  assert.equal(manifest.project, 'openape')
  assert.match(manifest.title, /^E2E \d{4}-\d{2}-\d{2} · abcdef1$/)
  assert.equal(manifest.tests.length, 1)
  const entry = manifest.tests[0]
  assert.equal(entry.status, 'failed')
  assert.deepEqual(entry.steps.map(s => s.status), ['passed', 'failed', 'skipped'])
  assert.match(entry.error, /rejects bad token/)
  assert.match(entry.error, /expected 401/)
  assert.match(manifest.summary, /1 passed, 1 failed, 1 skipped/)
})

test('marks tests that passed only after retry as flaky', () => {
  const manifest = buildManifest(
    [{ name: 'free-idp', report: vitestReport([fileResult('/repo/apps/idp/e2e/boot.e2e.test.ts', [retried, passing])]) }],
  )
  const steps = manifest.tests[0].steps
  assert.match(steps[0].caption, /Flaky: passed only after 1 failed attempt/)
  assert.equal(steps[1].caption, undefined)
  assert.match(manifest.summary, /Flaky — passed only after retry/)
  assert.match(manifest.summary, /free-idp · boots the dev server/)
  assert.equal(manifest.tests[0].status, 'passed')
})

test('records a missing suite report as an explicit skipped entry', () => {
  const manifest = buildManifest([
    { name: 'core', report: vitestReport([fileResult('/repo/t.test.ts', [passing])]) },
    { name: 'testrun', report: null },
  ])
  const placeholder = manifest.tests.find(t => t.id === 'testrun:no-report')
  assert.equal(placeholder.status, 'skipped')
  assert.match(manifest.summary, /testrun.*no report/)
})

test('throws when no suite produced a report', () => {
  assert.throws(
    () => buildManifest([{ name: 'core', report: null }]),
    /no suite produced a JSON report/,
  )
})

test('throws on a malformed report instead of silently skipping it', () => {
  assert.throws(
    () => buildManifest([{ name: 'core', report: { nonsense: true } }]),
    /no testResults array/,
  )
})
