import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { affectedWorkspaces, checkCommands, root, validateScripts } from './check.mjs'

const packages = [
  { name: 'core', path: 'packages/core', deps: {}, scripts: { lint: 'x', typecheck: 'x', test: 'x' } },
  { name: 'auth', path: 'packages/auth', deps: { core: '*' }, scripts: { lint: 'x', typecheck: 'x', test: 'x' } },
  { name: 'app', path: 'apps/app', deps: { auth: '*' }, scripts: { lint: 'x', typecheck: 'x', test: 'x', 'test:layout': 'x' } },
  { name: 'other', path: 'packages/other', deps: {}, scripts: { lint: 'x', typecheck: 'x', test: 'x' } },
]
const policy = { consumedApps: [], unitExceptions: {}, e2e: [], layout: ['app'] }
describe('shared check contract', () => {
  it('defaults to unit checks and runs E2E or layout only when explicitly selected', () => {
    const preview = (...args) => JSON.parse(execFileSync(process.execPath, ['scripts/check.mjs', 'ci', '--dry-run', ...args], { cwd: root, encoding: 'utf8' }))
    const automatic = preview()
    assert.deepEqual(automatic.suites, ['unit'])
    assert.ok(automatic.steps.some(step => step.name === 'test'))
    assert.ok(automatic.steps.every(step => !step.name.startsWith('e2e-') && !step.name.startsWith('layout-')))
    for (const suite of ['e2e', 'layout']) {
      const manual = preview('--suite', suite)
      assert.deepEqual(manual.suites, [suite])
      assert.ok(manual.steps.some(step => step.name.startsWith(`${suite}-`)))
    }
  })
  it('checks transitive consumers of a changed shared package', () => {
    assert.deepEqual(affectedWorkspaces(packages, ['packages/core/index.ts']).map(p => p.name), ['core', 'auth', 'app'])
    assert.deepEqual(affectedWorkspaces(packages, ['apps/app/page.vue']).map(p => p.name), ['app'])
    assert.equal(affectedWorkspaces(packages, ['pnpm-lock.yaml']).length, 4)
  })
  it('ignores documentation and agent notes but keeps generated architecture docs as root changes', () => {
    assert.deepEqual(affectedWorkspaces(packages, ['docs/operations/checks.md', '.claude/plans/x.md', 'AGENTS.md']), [])
    assert.deepEqual(affectedWorkspaces(packages, ['docs/agents/active-work.md', 'apps/app/page.vue']).map(p => p.name), ['app'])
    assert.equal(affectedWorkspaces(packages, ['docs/architecture/dependency-graph.md']).length, 4)
    assert.equal(affectedWorkspaces(packages, ['.githooks/pre-push']).length, 4)
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
