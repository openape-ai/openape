import { renderVersioned } from './render-versioned'
import { isVersioned } from './report-input'
import type { RunManifest, RunStep, RunTest } from '@openape/report-contracts/run-manifest'
import type { RenderContext } from './render-types'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { invalid, HTML_LIMIT, object } from '@openape/report-contracts/html'
import { aggregateStatus, validateManifest } from '@openape/report-contracts/run-manifest'
import { documentHtml, escapeHtml as e, markdown, masthead, meta } from './render-document'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const statusLabels = { passed: 'Passed', failed: 'Failed', skipped: 'Not run' }
const statusIcons = { passed: '✓', failed: '×', skipped: '−' }

function imageSource(path: string, directory: string, budget: { bytes: number }): string {
  const base = realpathSync(directory)
  const image = realpathSync(resolve(base, path))
  const local = relative(base, image)
  if (local === '..' || local.startsWith(`..${sep}`) || resolve(base, local) !== image) invalid(`Screenshot escapes the input directory: ${path}`)
  const stat = statSync(image)
  if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) invalid(`Screenshot must be a file of at most 8 MiB: ${path}`)
  budget.bytes += Math.ceil(stat.size / 3) * 4
  if (budget.bytes > HTML_LIMIT) invalid('Embedded evidence exceeds the 20 MiB report limit; resize screenshots before rendering')
  const bytes = readFileSync(image)
  const extension = extname(path).toLowerCase()
  const valid = extension === '.png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['.jpg', '.jpeg'].includes(extension)
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : extension === '.gif'
          ? /^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString())
          : extension === '.webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid) invalid(`Screenshot bytes do not match the raster image extension: ${path}`)
  return `data:${imageTypes[extension]};base64,${bytes.toString('base64')}`
}

function duration(manifest: RunManifest): string | undefined {
  for (const timestamp of [manifest.startedAt, manifest.finishedAt]) {
    if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp))) invalid('startedAt and finishedAt must be valid ordered timestamps')
  }
  if (!manifest.startedAt || !manifest.finishedAt) return undefined
  const milliseconds = Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) invalid('startedAt and finishedAt must be valid ordered timestamps')
  const seconds = Math.round(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function stepHtml(step: RunStep, directory: string, budget: { bytes: number }): string {
  const status = step.status ? `<span class="${step.status === 'failed' ? 'bad' : step.status === 'passed' ? 'good' : ''}">${statusIcons[step.status]} ${statusLabels[step.status]}</span>` : ''
  const shot = step.shot ? `<figure class="screenshot"><div class="sample-window"><div class="sample-toolbar">${e(step.shot)}</div><img src="${imageSource(step.shot, directory, budget)}" alt="${e(step.title)}"></div>${step.caption ? `<figcaption>${markdown(step.caption)}</figcaption>` : ''}</figure>` : markdown(step.caption)
  return `<section><div class="step">${status}<strong>${e(step.title)}</strong></div>${shot}</section>`
}

function testHtml(test: RunTest, directory: string, budget: { bytes: number }): string {
  return `<details class="test"${test.status === 'failed' ? ' open' : ''}><summary><span class="indicator ${test.status === 'failed' ? 'bad' : test.status === 'passed' ? 'good' : ''}">${statusIcons[test.status]}</span><span class="test-name">${e(test.title)}</span><span class="status">${statusLabels[test.status]}</span><span class="chevron">›</span></summary><div class="test-body">${markdown(test.description)}${test.error ? `<div class="error">${markdown(test.error)}</div>` : ''}${test.steps.map(step => stepHtml(step, directory, budget)).join('')}</div></details>`
}

function validateRendererFields(input: unknown) {
  const manifest = object(input, ['title', 'project', 'summary', 'series', 'startedAt', 'finishedAt', 'tests'])
  if (!Array.isArray(manifest.tests)) return
  for (const [index, value] of manifest.tests.entries()) {
    const test = object(value, ['id', 'title', 'description', 'status', 'error', 'steps'])
    if (test.steps === undefined || test.steps === null) continue
    if (!Array.isArray(test.steps)) invalid(`tests[${index}].steps must be an array`)
    for (const step of test.steps) object(step, ['title', 'caption', 'shot', 'status'])
  }
}

export function renderTestRun(input: unknown, directory: string, context: RenderContext = {}, templateDirectory?: string): string {
  if (isVersioned(input)) {
    if (Object.values(context).some(value => value !== undefined)) invalid('Versioned Test Runs record context in their input; legacy context flags are not supported')
    return renderVersioned(input, 'test-run', directory, templateDirectory).html
  }
  validateRendererFields(input)
  const manifest = validateManifest(input)
  const counts = aggregateStatus(manifest.tests)
  const elapsed = duration(manifest)
  const verdict = counts.failed ? 'Changes required' : counts.skipped ? 'Verification incomplete' : 'All checks passed'
  const verdictClass = counts.failed || counts.skipped ? 'verdict' : 'verdict good'
  const sorted = [...manifest.tests].sort((a, b) => ({ failed: 0, skipped: 1, passed: 2 }[a.status] - { failed: 0, skipped: 1, passed: 2 }[b.status]))
  const budget = { bytes: 0 }
  let renderedBytes = 0
  const tests = sorted.map((test) => {
    const html = testHtml(test, directory, budget)
    renderedBytes += Buffer.byteLength(html)
    if (renderedBytes > HTML_LIMIT) invalid('Embedded evidence exceeds the 20 MiB report limit; resize screenshots before rendering')
    return html
  }).join('')
  const metrics = [
    [String(counts.passed), 'Passed', 'good'], [String(counts.failed), 'Failed', 'bad'], [String(counts.skipped), 'Not run', ''],
    ...(elapsed ? [[elapsed, 'Total duration', '']] : []),
  ].map(([count, label, className]) => `<div><span class="number ${className}">${count}</span><span class="metric-label">${label}</span></div>`).join('')
  const content = `${masthead('Test Runs')}<main class="page"><div class="eyebrow">Verification report</div><h1>${e(manifest.title)}</h1><div class="lead markdown">${markdown(manifest.summary)}</div>${meta([manifest.project, manifest.startedAt, context.commit ? `Commit ${context.commit}` : 'Tested commit not provided'])}<div class="${verdictClass}"><div><strong>${verdict}</strong><p>${counts.failed ? 'Resolve the failed checks before claiming acceptance.' : counts.skipped ? 'The skipped checks are not evidence of passing behavior.' : 'Every check recorded in this run passed.'}</p></div></div><div class="numbers">${metrics}</div><div class="columns"><section><div class="section-heading"><h2>Checks that matter</h2><span class="small">${manifest.tests.length} ${manifest.tests.length === 1 ? 'check' : 'checks'} · failures first</span></div>${tests}</section><aside><section><h3>Run context</h3><dl><dt>Project</dt><dd>${e(manifest.project ?? 'Not provided')}</dd><dt>Tested commit</dt><dd><code>${e(context.commit ?? 'Not provided')}</code></dd><dt>Environment</dt><dd>${e(context.environment ?? 'Not provided')}</dd></dl></section>${context.command ? `<section><h3>Command</h3><pre><code>${e(context.command)}</code></pre></section>` : ''}${context.nextStep ? `<section><h3>Next step</h3>${markdown(context.nextStep)}</section>` : ''}</aside></div><div class="foot"><span>Legacy manifest: missing skip reasons and inspection attestations are not supplied by this format. Context commit is not attributed to individual checks. Results are supplied by the publisher; the renderer does not execute tests.</span></div></main>`
  return documentHtml('test-run', manifest.title, content, { 'tests.result': counts.failed ? 'failed' : counts.skipped && counts.passed ? 'incomplete' : counts.status  }, { manifest, context }, templateDirectory)
}
