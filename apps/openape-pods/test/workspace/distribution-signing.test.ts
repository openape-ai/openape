import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-signing-')); directories.push(root)
  const cwd = join(root, 'apps', 'pods'); mkdirSync(join(cwd, 'dist'), { recursive: true })
  writeFileSync(join(root, '.gitignore'), 'apps/pods/dist/\napps/pods/review.json\n')
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'fixture lock\n')
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '0.1.3' }))
  mkdirSync(join(cwd, 'runtime-sources/licenses'), { recursive: true })
  writeFileSync(join(cwd, 'runtime-sources/licenses/REVIEWED-NOTICES.txt'), 'Fixture notices\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Fixture')
  const build = { clean: true, sourceRevision: git('rev-parse', 'HEAD'), dependencyLockHash: createHash('sha256').update('fixture lock\n').digest('hex') }
  const saveBuild = (value = build) => writeFileSync(join(cwd, 'dist/build-inputs.json'), JSON.stringify(value))
  saveBuild()
  const moduleUrl = pathToFileURL(resolve('scripts/distribution.mjs')).href
  const check = (method = 'requireCleanBuild', candidate = true) => execFileSync(process.execPath, ['--input-type=module', '-e', `import {${method}} from ${JSON.stringify(moduleUrl)}; try { ${method}(${candidate}); console.log('accepted') } catch(error) { console.log(error.message) }`], { cwd, encoding: 'utf8', env: { ...process.env, OPENAPE_PODS_RELEASE_REVIEW: join(cwd, 'review.json') } }).trim()
  return { cwd, root, build, saveBuild, check }
}

describe('distribution signing gates', () => {
  it('accepts a clean current build and rejects dirty, stale and altered-lock builds', () => {
    const f = fixture(); expect(f.check()).toBe('accepted')
    f.saveBuild({ ...f.build, sourceRevision: '0'.repeat(40) }); expect(f.check()).toContain('fresh build')
    f.saveBuild({ ...f.build, dependencyLockHash: '0'.repeat(64) }); expect(f.check()).toContain('fresh build')
    f.saveBuild({ ...f.build, clean: false }); expect(f.check()).toContain('fresh build')
    f.saveBuild(); writeFileSync(join(f.root, 'unreviewed.txt'), 'dirty'); expect(f.check()).toContain('fresh build')
  })

  it('keeps external candidate signing blocked by a pending license review', () => {
    const f = fixture()
    writeFileSync(join(f.cwd, 'review.json'), JSON.stringify({ ...f.build, gates: { licenses: { status: 'pending' } } }))
    expect(f.check()).toBe('accepted')
    expect(f.check('requireReleaseReview')).toContain('Signed distribution gate is pending: licenses')
  })
  it('records the explicit 0.1.3 owner release without turning pending or failed checks into passes', () => {
    const f = fixture()
    const gates = Object.fromEntries(['licenses', 'signedBoundaries', 'cleanMachine', 'realProvider', 'realTenantRefresh', 'physicalSleepWake', 'osCpuMatrix'].map(gate => [gate, { status: 'pending' }]))
    const review = { ...f.build, gates, supplementalNoticesSha256: createHash('sha256').update('Fixture notices\n').digest('hex'), ownerAuthorization: { version: '0.1.3', approvedBy: 'Patrick Hofmann', instruction: 'veröffentliche einen signierten build auf der Website', evidence: 'https://repos.openape.ai/patrick/monorepo/issues/1453', pendingGates: Object.keys(gates) } }
    const save = () => writeFileSync(join(f.cwd, 'review.json'), JSON.stringify(review))
    save(); expect(f.check('requireReleaseReview', false)).toBe('accepted')
    expect(f.check('requireReleaseReview')).toContain('pending: licenses')
    gates.licenses.status = 'failed'; save()
    expect(f.check('requireReleaseReview', false)).toContain('pending: licenses')
    gates.licenses.status = 'pending'; review.ownerAuthorization.pendingGates = []; save()
    expect(f.check('requireReleaseReview', false)).toContain('pending: licenses')
    review.ownerAuthorization.pendingGates = Object.keys(gates); review.ownerAuthorization.version = '0.1.4'; save()
    expect(f.check('requireReleaseReview', false)).toContain('pending: licenses')
  })

})
