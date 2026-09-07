import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { affectedWorkspaces, checkCommands, validateScripts } from './check.mjs'

const packages = [
  { name: 'core', path: 'packages/core', deps: {}, scripts: { lint: 'x', typecheck: 'x', test: 'x' } },
  { name: 'auth', path: 'packages/auth', deps: { core: '*' }, scripts: { lint: 'x', typecheck: 'x', test: 'x' } },
  { name: 'app', path: 'apps/app', deps: { auth: '*' }, scripts: { lint: 'x', typecheck: 'x', test: 'x', 'test:layout': 'x' } },
  { name: 'other', path: 'packages/other', deps: {}, scripts: { lint: 'x', typecheck: 'x', test: 'x' } },
]
const policy = { consumedApps: [], unitExceptions: {}, e2e: [], layout: ['app'] }
describe('shared check contract', () => {
  it('checks transitive consumers of a changed shared package', () => {
    assert.deepEqual(affectedWorkspaces(packages, ['packages/core/index.ts']).map(p => p.name), ['core', 'auth', 'app'])
    assert.deepEqual(affectedWorkspaces(packages, ['apps/app/page.vue']).map(p => p.name), ['app'])
    assert.equal(affectedWorkspaces(packages, ['pnpm-lock.yaml']).length, 4)
  })
  it('fails when a mandatory script disappears', () => {
    assert.throws(() => validateScripts(packages.map(p => ({ ...p, scripts: {} })), policy), /Missing required script/)
    assert.throws(() => validateScripts(packages, { ...policy, layout: ['missing'] }), /missing:test:layout/)
    assert.doesNotThrow(() => validateScripts(packages, policy))
  })
  it('uses the same commands locally and in CI and never silently omits the layout script', () => {
    const steps = checkCommands(packages, packages, ['unit', 'layout'], policy)
    assert.ok(steps[0].args.includes('--concurrency=1'))
    assert.deepEqual(steps.at(-1).args, ['--filter', 'app', 'test:layout'])
    assert.equal(checkCommands(packages, [], ['unit'], policy).length, 0)
  })
})
