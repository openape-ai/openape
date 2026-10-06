// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'

let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
function fixture(status = 'passed') {
  directory = mkdtempSync(join(tmpdir(), 'pods-report-'))
  mkdirSync(join(directory, 'screenshots'))
  const startedAt = new Date(Date.now() - 10000).toISOString()
  const receipt = { source: { revision: 'a'.repeat(40), dirty: false }, startedAt, finishedAt: new Date().toISOString(), commands: [{ name: 'components', exitCode: status === 'failed' ? 1 : 0, command: 'vitest run' }], images: {} as Record<string, string> }
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt))
  writeFileSync(join(directory, 'components.json'), JSON.stringify({ testResults: [{ name: '/test/workspace/example.test.ts', status, assertionResults: [{ fullName: 'Permission refusal', status, failureMessages: status === 'failed' ? ['Rejected an invalid grant'] : [] }] }] }))
  return receipt
}
function assemble(...args: string[]) { return spawnSync(process.execPath, [resolve('scripts/report.mjs'), '--browser', '--assemble', directory, ...args], { encoding: 'utf8' }) }
it('retains failed assertions and rejects missing images instead of reporting visual success', () => {
  fixture('failed')
  expect(assemble().status).toBe(1)
  const manifest = JSON.parse(readFileSync(join(directory, 'testrun.json'), 'utf8'))
  expect(manifest.tests[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('Rejected an invalid grant') })
  expect(manifest.tests.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('Missing screenshots') })
  expect(assemble('--reviewed').stderr).toContain('Cannot accept incomplete evidence')
})
it('rejects altered screenshot bytes from an earlier capture receipt', () => {
  const receipt = fixture()
  const name = 'variant-a-pods.png'
  receipt.images[name] = createHash('sha256').update('original capture').digest('hex')
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt))
  writeFileSync(join(directory, 'screenshots', name), 'different capture')
  const result = assemble()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`Stale or changed screenshot: ${name}`)
})
