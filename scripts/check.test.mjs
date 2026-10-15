import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { affectedWorkspaces, changedFiles, checkCommands, checkEnvironment, root, runStep, validateScripts } from './check.mjs'

const packages = [
  { name: 'core', path: 'packages/core', deps: {}, scripts: { build: 'x', lint: 'x', typecheck: 'x', test: 'x' } },
  { name: 'auth', path: 'packages/auth', deps: { core: '*' }, scripts: { build: 'x', lint: 'x', typecheck: 'x', test: 'x' } },
  { name: 'app', path: 'apps/app', deps: { auth: '*' }, scripts: { build: 'x', lint: 'x', typecheck: 'x', test: 'x', 'test:layout': 'x' } },
  { name: 'other', path: 'packages/other', deps: {}, scripts: { build: 'x', lint: 'x', typecheck: 'x', test: 'x' } },
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
      const pods = manual.steps.find(step => step.name === `${suite}--openape-pods`)
      assert.ok(pods, `Pods acceptance must remain reachable in the explicit ${suite} suite`)
      assert.deepEqual(pods.args, ['--filter', '@openape/pods', `test:${suite}`])
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
  it('prebuilds transitive dependencies without unrelated packages or the selected app', () => {
    const steps = checkCommands(packages, [packages[2]], ['unit'], policy)
    assert.deepEqual(steps[0].args, ['turbo', 'run', 'build', '--filter=core', '--filter=auth', '--concurrency=1'])
    const consumed = checkCommands(packages, [packages[2]], ['unit'], { ...policy, consumedApps: ['app'] })
    assert.ok(consumed[0].args.includes('--filter=app'))
    const isolated = { name: 'isolated', path: 'apps/isolated', deps: {}, scripts: { lint: 'x', typecheck: 'x', test: 'x' } }
    assert.equal(checkCommands([...packages, isolated], [isolated], ['unit'], policy)[0].name, 'audit')
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

it('isolates the actual check subprocess from hook repository and config overrides', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'openape-check-environment-'))
  const parent = join(directory, 'parent'); const fixture = join(directory, 'fixture.git')
  const environment = checkEnvironment()
  const git = (args, cwd = directory, env = environment) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()
  const overrides = { GIT_DIR: join(parent, '.git'), GIT_INDEX_FILE: join(parent, '.git/index'), GIT_CONFIG_PARAMETERS: '\'core.hooksPath\'=\'/synthetic-hook-override\'', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/synthetic-hook-override' }
  const previous = Object.fromEntries(Object.keys(overrides).map(name => [name, process.env[name]]))
  try {
    git(['init', parent]); mkdirSync(fixture)
    git(['init', '--bare'], fixture, { ...environment, ...overrides })
    assert.equal(git(['config', '--get', 'core.bare'], parent), 'true')
    git(['config', 'core.bare', 'false'], parent)
    Object.assign(process.env, overrides)
    assert.equal(await runStep({ command: 'git', args: ['-C', fixture, 'init', '--bare'] }, join(directory, 'probe.log')), 0)
    assert.equal(git(['config', '--get', 'core.bare'], parent), 'false')
    assert.equal(git(['rev-parse', '--is-bare-repository'], fixture), 'true')
    const contaminated = { ...environment, ...overrides, GIT_WORK_TREE: parent, VITEST_MAX_WORKERS: '4' }
    const isolated = checkEnvironment(contaminated)
    for (const name of [...Object.keys(overrides), 'GIT_WORK_TREE']) assert.equal(isolated[name], undefined)
    assert.equal(isolated.VITEST_MAX_WORKERS, '4')
    assert.equal(contaminated.GIT_DIR, join(parent, '.git'))
  }
  finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
    rmSync(directory, { recursive: true, force: true })
  }
})

function gitFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'openape-check-scope-'))
  const environment = checkEnvironment()
  const git = (...args) => execFileSync('git', args, { cwd: directory, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (path, content = path) => {
    mkdirSync(join(directory, path, '..'), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Check fixture'); git('config', 'user.email', 'check@example.invalid')
    git('config', 'core.hooksPath', '/dev/null')
    write('packages/core/index.ts'); write('apps/app/page.vue'); write('packages/other/index.ts')
    git('add', '.'); git('commit', '-m', 'Initial source')
    run({ directory, environment, git, write })
  }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

it('selects only local changes at an equal base, including staged, deleted and untracked paths', () => {
  gitFixture(({ directory, git, write }) => {
    const head = git('rev-parse', 'HEAD')
    assert.deepEqual(changedFiles(directory, head, head), { base: head, files: [] })
    write('apps/app/page.vue', 'edited'); git('add', 'apps/app/page.vue')
    write('apps/app/new file.vue'); rmSync(join(directory, 'packages/other/index.ts'))
    const changes = changedFiles(directory, head, head)
    assert.equal(changes.base, head)
    assert.deepEqual(changes.files.sort(), ['apps/app/new file.vue', 'apps/app/page.vue', 'packages/other/index.ts'])
    assert.deepEqual(affectedWorkspaces(packages, changes.files).map(p => p.name), ['app', 'other'])
    write('pnpm-lock.yaml')
    assert.equal(affectedWorkspaces(packages, changedFiles(directory, head, head).files).length, packages.length)
  })
})

it('excludes main-only changes while retaining branch changes and transitive consumers', () => {
  gitFixture(({ directory, git, write }) => {
    const fork = git('rev-parse', 'HEAD')
    git('branch', 'feature')
    write('pnpm-lock.yaml', 'main-only dependency change'); git('add', '.'); git('commit', '-m', 'Main advances')
    git('checkout', 'feature')
    write('packages/core/index.ts', 'feature change'); git('add', '.'); git('commit', '-m', 'Change shared package')
    const changes = changedFiles(directory, 'main', 'HEAD')
    assert.equal(changes.base, fork)
    assert.deepEqual(changes.files, ['packages/core/index.ts'])
    assert.deepEqual(affectedWorkspaces(packages, changes.files).map(p => p.name), ['core', 'auth', 'app'])
    git('mv', 'packages/core/index.ts', 'packages/other/moved.ts')
    const moved = changedFiles(directory, 'HEAD', 'HEAD')
    assert.deepEqual(moved.files.sort(), ['packages/core/index.ts', 'packages/other/moved.ts'])
    assert.deepEqual(affectedWorkspaces(packages, moved.files).map(p => p.name), ['core', 'auth', 'app', 'other'])
    assert.throws(() => changedFiles(directory, 'missing-base', 'HEAD'))
  })
})

it('runs the complete gate only at push and preserves commit and push refusals', () => {
  gitFixture(({ directory, environment, git, write }) => {
    const trace = join(directory, 'commands.log')
    write('bin/pnpm', '#!/bin/sh\nprintf "pnpm %s\\n" "$*" >> "$CHECK_TRACE"\nexit "$CHECK_EXIT"\n')
    write('bin/node', '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CHECK_TRACE"\nexit "$DESTINATION_EXIT"\n')
    for (const binary of ['pnpm', 'node']) chmodSync(join(directory, 'bin', binary), 0o755)
    git('remote', 'add', 'origin', directory)
    const hook = (name, overrides = {}) => spawnSync('bash', [join(root, '.githooks', name), 'origin', directory], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...environment, PATH: `${join(directory, 'bin')}:${environment.PATH}`, CI: '', SKIP_HOOKS: '', CHECK_TRACE: trace, CHECK_EXIT: '0', DESTINATION_EXIT: '0', ...overrides },
    })
    const commands = () => readFileSync(trace, 'utf8').trim().split('\n')
    git('checkout', '-b', 'feature')
    write('apps/app/page.vue', 'changed'); git('add', 'apps/app/page.vue')
    writeFileSync(trace, '')
    assert.equal(hook('pre-commit').status, 0)
    assert.equal(readFileSync(trace, 'utf8'), '')
    assert.equal(hook('pre-push').status, 0)
    assert.equal(commands().filter(line => line.startsWith('pnpm ')).length, 1)
    assert.equal(commands().at(-1), 'pnpm check:affected --base origin/main --head HEAD --suite unit')
    assert.equal(hook('pre-push', { CHECK_EXIT: '1' }).status, 1)
    writeFileSync(trace, '')
    assert.equal(hook('pre-push', { DESTINATION_EXIT: '1' }).status, 1)
    assert.ok(commands().every(line => !line.startsWith('pnpm ')))
    write('apps/app/package.json', '{}'); git('add', 'apps/app/package.json')
    assert.equal(hook('pre-commit', { CHECK_EXIT: '1' }).status, 1)
    git('reset', '--hard', 'HEAD'); git('checkout', 'main')
    write('apps/app/page.vue', 'forbidden'); git('add', 'apps/app/page.vue')
    assert.equal(hook('pre-commit').status, 1)
  })
})
