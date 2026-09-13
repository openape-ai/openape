import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const directory = '.artifacts'
const result = JSON.parse(readFileSync(join(directory, 'electron-tests.json'), 'utf8'))
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const shots = [
  ['workspace-1060-light-overview.png', 'A pod with durable knowledge', 'Overview shows the stored assignment, current findings, open questions, verification gaps and the next run.'],
  ['workspace-760-dark-knowledge.png', 'Knowledge and exact evidence', 'Current claims remain distinct from history, questions and verification gaps.'],
  ['workspace-source.png', 'A pinned source version', 'The source viewer shows the exact stored content and digest supporting a finding.'],
  ['workspace-560-light-resources.png', 'Explicit resource scope', 'Resources remains usable in a narrow window, with per-pod access and revocation.'],
  ['workspace-master.png', 'One contextual master area', 'Contextual actions retain the selected pod. Streaming and control actions are connected in the master milestone.'],
  ['recovery-packaged.png', 'Explicit recovery after an app crash', 'The packaged app preserves a committed fact and checkpoint. Inspection confirms previous execution has stopped before an explicit retry completes the remaining inputs.'],
  ['schedule-settings.png', 'Explicit schedules and concurrency', 'A disabled daily schedule records its local time and timezone. Activation, pause/resume and the global concurrency limit are separate owner controls.'],
  ['runs-packaged.png', 'Manual script execution', 'A bundled script completes inside the native boundary. Runs shows its persisted result, checkpoint revision and ordered events.'],
  ['resources-packaged.png', 'Assigned reference snapshots', 'The packaged app lists the chosen file, its permission revision and the hash of a separate snapshot. Access can be revoked from the same view.'],
  ['storage-settings.png', 'Saved local assignments', 'A pod assignment is committed by the SQLite worker and reopens after restarting the application. New pods remain paused.'],
  ['foundation-light.png', 'Your pod workspace', 'An empty profile shows no invented pod or knowledge. The local worker status is reported directly.'],
  ['foundation-dark.png', 'Dark appearance', 'The workspace follows the dark color scheme while keeping the same navigation and state visible.'],
  ['foundation-compact.png', 'Compact desktop window', 'At the minimum supported window size, navigation and worker status stay visible while the content scrolls.'],
  ['foundation-worker-error.png', 'Explicit worker recovery', 'When the worker stops unexpectedly, the workspace shows Needs attention and explains how to recover.'],
]
const tests = result.testResults.flatMap(file => file.assertionResults)
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
const cards = shots.map(([file, title, caption]) => `<article><h2>${escape(title)}</h2><p>${escape(caption)}</p><img alt="${escape(title)}" src="data:image/png;base64,${readFileSync(join(directory, file)).toString('base64')}"></article>`).join('\n')
const outcomes = tests.map(test => `<li><strong>${escape(test.status)}</strong> · ${escape(test.fullName)}${test.failureMessages.length ? `<pre>${escape(test.failureMessages.join('\n'))}</pre>` : ''}</li>`).join('\n')
writeFileSync(join(directory, 'foundation-report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenApe Pods desktop evidence</title><style>body{font:15px/1.6 system-ui;margin:30px auto;padding:0 24px;max-width:1100px;background:#f5f6f3;color:#243027}article{background:white;padding:24px;border:1px solid #dde3da;border-radius:12px;margin:24px 0}img{max-width:100%;height:auto;border-radius:8px}h1,h2{line-height:1.3}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}li{margin:12px 0}</style><h1>OpenApe Pods · Pod workspace</h1><p>Fixture-only macOS application. Electron 40.9.3 · bundled Node 24.14.1 · arm64. This evidence does not authorize live resources or certify release signing.</p><p>Revision <code>${escape(revision)}</code>${dirty ? ' with local changes' : ''}. ${result.numPassedTests} passing / ${result.numFailedTests} failing Electron tests.</p><ul>${outcomes}</ul>${cards}</html>`)
console.log(`Evidence: ${join(directory, 'foundation-report.html')}`)
