import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Evidence for the Pods redesign (plan 01M48KYW8JJKRSRDWRJ9DQT13Q): runs the worker, renderer and
 * browser layout suites of the redesign, keeps their JSON outcomes and the layout screenshots, and
 * writes a Test Runs manifest whose screens carry the ids, titles and captions of the reference run
 * https://testrun.openape.ai/r/8iEfvEULQMKiNMi2Uyj-c4QY, so reference and product compare side by side.
 *
 *   node scripts/redesign-evidence.mjs --milestone M1            # run and capture
 *   node scripts/redesign-evidence.mjs --assemble DIR --reviewed  # after personal inspection
 *   ape-testruns upload DIR --json
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function option(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const milestone = option('--milestone') ?? 'M1'
const assemble = option('--assemble')
const reviewed = args.includes('--reviewed')
const directory = assemble ? resolve(assemble) : join(root, '.artifacts', 'redesign-evidence', `${new Date().toISOString().replaceAll(':', '-')}-${milestone}-${randomUUID().slice(0, 8)}`)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const reference = JSON.parse(readFileSync(join(root, '../../.claude/plans/pods-redesign/testrun.json'), 'utf8'))
const suites = [
  ['worker', ['test/worker']],
  ['renderer', ['test/renderer']],
  ['layout', ['--config', 'vitest.browser.config.ts', 'test/layout/automations.test.ts']],
]
if (!assemble) {
  mkdirSync(join(directory, 'screenshots'), { recursive: true })
  const source = { revision: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain') }
  const receipt = { milestone, source, startedAt: new Date().toISOString(), commands: [] }
  const vitest = join(root, 'node_modules/vitest/vitest.mjs')
  for (const [name, config] of suites) {
    const command = ['run', ...config, '--reporter=default', '--reporter=json', `--outputFile.json=${join(directory, `${name}.json`)}`]
    const result = spawnSync(process.execPath, [vitest, ...command], { cwd: root, env: { ...process.env, VITE_PODS_SCREENSHOT_DIR: join(directory, 'screenshots') }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    writeFileSync(join(directory, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`)
    receipt.commands.push({ name, command: `vitest ${command.join(' ')}`, exitCode: result.status ?? 1 })
    console.log(`${name}: exit ${result.status ?? 1}`)
  }
  receipt.finishedAt = new Date().toISOString()
  receipt.images = Object.fromEntries(readdirSync(join(directory, 'screenshots')).filter(name => name.endsWith('.png')).map(name => [name, createHash('sha256').update(readFileSync(join(directory, 'screenshots', name))).digest('hex')]))
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2))
}
const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'))
const tests = []
const outcomes = []
for (const command of receipt.commands) {
  const path = join(directory, `${command.name}.json`)
  if (!existsSync(path)) { tests.push({ id: command.name, title: command.name, status: 'failed', error: `Runner exited ${command.exitCode} without JSON results.` }); continue }
  const result = JSON.parse(readFileSync(path, 'utf8'))
  for (const file of result.testResults) {
    const failed = file.assertionResults.filter(test => test.status === 'failed')
    tests.push({ id: `${command.name}-${file.name.split('/test/').at(-1)}`, title: file.name.split('/test/').at(-1), status: failed.length || file.status === 'failed' ? 'failed' : 'passed', description: `${file.assertionResults.length - failed.length} passed · ${failed.length} failed. ${command.command}`, ...(failed.length ? { error: failed.map(test => `${test.fullName}\n${test.failureMessages.join('\n')}`).join('\n\n') } : {}) })
    outcomes.push(...file.assertionResults)
  }
}
const captured = name => existsSync(join(directory, 'screenshots', `redesign-${name}`))
for (const name of Object.keys(receipt.images)) {
  if (createHash('sha256').update(readFileSync(join(directory, 'screenshots', name))).digest('hex') !== receipt.images[name]) throw new Error(`Changed screenshot: ${name}`)
}
const screens = reference.tests.map(test => ({ ...test, steps: test.steps.filter(step => captured(step.shot)) })).filter(test => test.steps.length)
tests.push({ id: 'visual-review', title: `Product screens of ${milestone} against the reference run`, status: reviewed ? 'passed' : 'skipped', description: reviewed ? 'Every screenshot below was personally inspected against the reference images of the mock; differences are listed in the plan.' : 'Screenshots captured; personal inspection is still required.', steps: screens.flatMap(test => test.steps.map(step => ({ title: `${test.title} · ${step.title}`, caption: `${step.caption} Reference: ${step.shot}.`, shot: `screenshots/redesign-${step.shot}` }))) })
const summary = `${milestone} of the Pods redesign at revision ${receipt.source.revision}${receipt.source.dirty ? ' with local changes' : ''}: ${outcomes.filter(test => test.status === 'passed').length} passed / ${outcomes.filter(test => test.status === 'failed').length} failed assertions in the worker, renderer and browser layout suites. Synthetic 38-Pod profile (test/renderer/map-view.json), production stylesheet in Chrome; no installed app. Reference run of the mock: https://testrun.openape.ai/r/8iEfvEULQMKiNMi2Uyj-c4QY (same screen ids).`
const manifest = { title: `OpenApe Pods redesign · ${milestone}`, project: 'openape-pods', summary, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, tests }
writeFileSync(join(directory, 'testrun.json'), JSON.stringify(manifest, null, 2))
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const cards = tests.at(-1).steps.map(step => `<article><h2>${escape(step.title)}</h2><p>${escape(step.caption)}</p><img alt="${escape(step.title)}" src="data:image/png;base64,${readFileSync(join(directory, step.shot)).toString('base64')}"></article>`).join('')
writeFileSync(join(directory, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(manifest.title)}</title><style>body{font:15px/1.6 system-ui;max-width:1100px;margin:30px auto;padding:0 24px;color:#203127;background:#f7f8f5}article{background:white;padding:24px;border:1px solid #dce3dc;border-radius:12px;margin:24px 0}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>${escape(manifest.title)}</h1><p>${escape(summary)}</p><p>${reviewed ? 'Screenshots personally inspected.' : 'Visual review pending.'}</p><details><summary>All ${outcomes.length} assertions</summary>${outcomes.map(test => `<p><strong>${escape(test.status)}</strong> ${escape(test.fullName)}</p>`).join('')}</details>${cards}</html>`)
console.log(`Report directory: ${directory}`)
console.log(reviewed ? `Publish: ape-testruns upload '${directory}' --json` : `Inspect screenshots, then: node scripts/redesign-evidence.mjs --assemble '${directory}' --reviewed`)
if (tests.some(test => test.status === 'failed')) process.exitCode = 1
