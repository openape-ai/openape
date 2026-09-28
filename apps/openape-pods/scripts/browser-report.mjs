import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const assemble = args.indexOf('--assemble')
const directory = assemble >= 0 ? resolve(args[assemble + 1]) : join(root, '.artifacts', 'browser-reports', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
const reviewed = args.includes('--reviewed')
if (reviewed && assemble < 0) throw new Error('Inspect the captured images first, then use --assemble DIRECTORY --reviewed')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const shots = [
  ['variant-a-workflow.png', 'Workflow and dependencies'],
  ['variant-a-pods.png', 'Standalone Pods and workflow membership'],
  ['variant-a-archive.png', 'Archived Pods'],
  ['variant-a-script.png', 'Editable script with syntax highlighting'],
  ['variant-a-permissions.png', 'Assigned permissions and folders'],
  ['variant-a-pod-settings.png', 'Pod identity, schedule and settings'],
  ['variant-a-history.png', 'Execution history'],
  ['variant-a-settings.png', 'Personal accounts and app-wide MCP access'],
  ['variant-a-mcp-dark.png', 'Timed MCP access in a narrow dark window'],
  ['workflows-560.png', 'Workflow graph in a narrow dark window'],
  ['workspace-source.png', 'Retained source evidence'],
  ['central-unsaved-edits.png', 'Remote edits require explicit discard before leaving'],
]
if (assemble < 0) {
  mkdirSync(join(directory, 'screenshots'), { recursive: true })
  const source = { revision: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'), diffHash: createHash('sha256').update(git('diff', 'HEAD')).digest('hex') }
  const receipt = { source, environment: { node: process.versions.node, browser: 'Chrome via Vitest Browser / Playwright', screenshotSettings: 'Variant A: de, 1280x1000 light / 560x1000 dark; workflow: en, 560x900 dark; source: en, 1060x850 light (element capture); unsaved edits: de, 560x950 dark' }, startedAt: new Date().toISOString(), commands: [] }
  const vitest = join(root, 'node_modules/vitest/vitest.mjs')
  for (const [name, config] of [['components', []], ['browser', ['--config', 'vitest.browser.config.ts']]]) {
    const command = ['run', ...config, '--reporter=default', '--reporter=json', `--outputFile.json=${join(directory, `${name}.json`)}`]
    const result = spawnSync(process.execPath, [vitest, ...command], { cwd: root, env: { ...process.env, VITE_PODS_SCREENSHOT_DIR: join(directory, 'screenshots') }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    writeFileSync(join(directory, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`)
    receipt.commands.push({ name, command: `vitest ${command.join(' ')}`, exitCode: result.status ?? 1 })
    console.log(`${name}: exit ${result.status ?? 1}; ${join(directory, `${name}.log`)}`)
  }
  receipt.finishedAt = new Date().toISOString()
  receipt.sourceUnchanged = source.revision === git('rev-parse', 'HEAD') && source.diffHash === createHash('sha256').update(git('diff', 'HEAD')).digest('hex')
  receipt.images = Object.fromEntries(readdirSync(join(directory, 'screenshots')).filter(name => name.endsWith('.png')).map(name => [name, createHash('sha256').update(readFileSync(join(directory, 'screenshots', name))).digest('hex')]))
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2))
}
const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'))
const tests = []
if (receipt.sourceUnchanged === false) tests.push({ id: 'source-changed', title: 'Source consistency', status: 'failed', error: 'The source changed while tests were running. Start a fresh evidence run.' })
const outcomes = []
for (const command of receipt.commands) {
  const resultPath = join(directory, `${command.name}.json`)
  if (!existsSync(resultPath)) { tests.push({ id: command.name, title: command.name, status: 'failed', error: `Runner exited ${command.exitCode} without JSON results. See ${command.name}.log.` }); continue }
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  for (const [index, file] of result.testResults.entries()) {
    const failed = file.assertionResults.filter(test => test.status === 'failed')
    const passed = file.assertionResults.filter(test => test.status === 'passed')
    const skipped = file.assertionResults.length - failed.length - passed.length
    tests.push({ id: `${command.name}-${index}`, title: file.name.split('/test/').at(-1), status: failed.length || file.status === 'failed' ? 'failed' : passed.length ? 'passed' : 'skipped', description: `${passed.length} passed · ${failed.length} failed · ${skipped} skipped. ${command.command}`, ...(failed.length ? { error: failed.map(test => `${test.fullName}\n${test.failureMessages.join('\n')}`).join('\n\n') } : {}) })
    outcomes.push(...file.assertionResults.map(test => ({ suite: command.name, ...test })))
  }
  if (command.exitCode !== 0 && !tests.some(test => test.id.startsWith(command.name) && test.status === 'failed')) tests.push({ id: `${command.name}-runner`, title: `${command.name} runner`, status: 'failed', error: `Exit ${command.exitCode}; inspect the run log for unhandled errors.` })
}
const missing = shots.filter(([name]) => !existsSync(join(directory, 'screenshots', name)))
for (const [name] of shots.filter(([name]) => existsSync(join(directory, 'screenshots', name)))) {
  const path = join(directory, 'screenshots', name)
  if (statSync(path).mtimeMs < Date.parse(receipt.startedAt) || createHash('sha256').update(readFileSync(path)).digest('hex') !== receipt.images[name]) throw new Error(`Stale or changed screenshot: ${name}`)
}
if (reviewed && missing.length) throw new Error(`Cannot accept incomplete evidence: ${missing.map(([name]) => name).join(', ')}`)
tests.push({ id: 'visual-review', title: 'Variant A visual review', status: missing.length ? 'failed' : reviewed ? 'passed' : 'skipped', description: reviewed ? 'The attached production-component screenshots were personally inspected for layout, readability and the approved Variant A navigation.' : 'Screenshots captured; personal visual review is still required.', ...(missing.length ? { error: `Missing screenshots: ${missing.map(([name]) => name).join(', ')}` } : {}), steps: shots.filter(([name]) => existsSync(join(directory, 'screenshots', name))).map(([name, title]) => ({ title, caption: 'Real Vue components and production CSS in Chrome, with synthetic IPC/service data.', shot: `screenshots/${name}` })) })
const summary = `Revision ${receipt.source.revision}${receipt.source.dirty ? ' with local changes (not a clean commit)' : ''}. ${outcomes.filter(test => test.status === 'passed').length} passed / ${outcomes.filter(test => test.status === 'failed').length} failed assertions. Unit/component and manual Vitest Browser suites. ${receipt.environment?.screenshotSettings ?? ''}. Synthetic data only; no installed app replacement or live account operations. Screenshot capture alone is not visual acceptance. [Approved mock](https://report.openape.ai/r/uEo8I0_9Dx0_96OxRAoc1MmK). Implementation retains the established dependency editor, permission lists and recovery views within the new navigation.`
const manifest = { title: 'OpenApe Pods · Variant A implementation', project: 'OpenApe Pods', summary, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, tests }
writeFileSync(join(directory, 'testrun.json'), JSON.stringify(manifest, null, 2))
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const cards = shots.filter(([name]) => existsSync(join(directory, 'screenshots', name))).map(([name, title]) => `<article><h2>${escape(title)}</h2><img alt="${escape(title)}" src="data:image/png;base64,${readFileSync(join(directory, 'screenshots', name)).toString('base64')}"></article>`).join('')
writeFileSync(join(directory, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${manifest.title}</title><style>body{font:15px/1.6 system-ui;max-width:1100px;margin:30px auto;padding:0 24px;color:#203127;background:#f7f8f5}article{background:white;padding:24px;border:1px solid #dce3dc;border-radius:12px;margin:24px 0}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>${manifest.title}</h1><p>${escape(summary)}</p><p>${reviewed ? 'Screenshots personally inspected.' : 'Visual review pending.'}</p><details><summary>Commands and source receipt</summary><pre>${escape(JSON.stringify(receipt, null, 2))}</pre></details><details><summary>All ${outcomes.length} assertions</summary>${outcomes.map(test => `<p><strong>${escape(test.status)}</strong> ${escape(test.fullName)}</p>${test.failureMessages.length ? `<pre>${escape(test.failureMessages.join('\n'))}</pre>` : ''}`).join('')}</details>${cards}</html>`)
console.log(`Report directory: ${directory}`)
console.log(reviewed ? `Publish: ape-testruns upload '${directory}' --json` : `Inspect screenshots, then: pnpm report --browser --assemble '${directory}' --reviewed`)
if (tests.some(test => test.status === 'failed')) process.exitCode = 1
