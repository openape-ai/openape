// Sanity tests for scripts/e2e.mjs — run with:
//   node --test scripts/e2e.test.mjs
import assert from 'node:assert/strict'
// node:test on purpose (not vitest): this runs dependency-free, before any
// workspace tooling. eslint's autofix rewrites this import to vitest and the
// file then silently stops running — leave it as is.
// eslint-disable-next-line test/no-import-node-test
import { test } from 'node:test'
import { parseArgs, SUITES, turboArgs } from './e2e.mjs'

test('runs every suite by default', () => {
  const args = parseArgs([])
  assert.equal(args.suites.length, SUITES.length)
  assert.equal(args.affected, false)
})

test('--suite narrows to one', () => {
  assert.deepEqual(parseArgs(['--suite', 'pr']).suites.map(s => s.name), ['pr'])
})

test('an unknown suite fails loudly instead of running nothing', () => {
  assert.throws(() => parseArgs(['--suite', 'nope']), /unknown suite "nope"/)
})

test('an unknown flag fails loudly', () => {
  assert.throws(() => parseArgs(['--fast']), /unknown argument/)
})

test('--affected adds the flag turbo needs, and only then', () => {
  const suite = SUITES.find(s => s.name === 'pr')
  assert.deepEqual(turboArgs(suite, true), ['turbo', 'run', 'test:e2e', '--affected', '--filter=@openape-pr/app'])
  assert.deepEqual(turboArgs(suite, false), ['turbo', 'run', 'test:e2e', '--filter=@openape-pr/app'])
})

test('the core suite runs vitest`s plain test task, the app suites test:e2e', () => {
  assert.equal(SUITES.find(s => s.name === 'core').task, 'test')
  for (const name of ['testrun', 'pr', 'free-idp']) {
    assert.equal(SUITES.find(s => s.name === name).task, 'test:e2e')
  }
})
