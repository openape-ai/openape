#!/usr/bin/env node
// Reports bounded log excerpts; complete logs remain in the workflow artifact.
// The HMAC secret is scoped to one native repository and supplied only to this
// final reporting step, never to the check subprocess environment.
import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync, existsSync, realpathSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const [suite] = process.argv.slice(2)
const contexts = { unit: 'CI / ci (push)', e2e: 'e2e / e2e (push)', layout: 'layout / layout (push)' }
if (!contexts[suite]) throw new Error('Expected unit, e2e or layout suite')
const secret = process.env.APE_GIT_STATUS_SECRET
if (!secret) throw new Error('APE_GIT_STATUS_SECRET is required for native check reporting')
const sha = process.env.GITHUB_SHA
if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Full source SHA required')
const root = '.openape/check-results'
const run = existsSync(root) ? readdirSync(root).filter(n => new RegExp(`^[0-9]+-${sha.slice(0, 8)}-${suite}$`).test(n)).sort().at(-1) : null
function readReportFile(name) {
  if (!run || !/^[a-z0-9-]+\.(json|log)$/i.test(name)) throw new Error('Invalid report filename')
  const dir = realpathSync(root)
  const path = join(root, run, name)
  if (!lstatSync(path).isFile() || !realpathSync(path).startsWith(`${dir}/`)) throw new Error('Report must be a regular file inside the check results directory')
  return readFileSync(path, 'utf8')
}
const summary = run ? JSON.parse(readReportFile('summary.json')) : null
if (summary && summary.head !== sha) throw new Error('Refusing to report a summary for a different SHA')
const state = summary?.status === 'success' && process.env.APE_CHECK_JOB_STATUS === 'success' ? 'success' : 'failure'
const url = new URL(`${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_NUMBER}`, `${process.env.GITHUB_SERVER_URL}/`).href
const excerpts = [`${suite}: ${state}. Full logs: workflow artifact ${suite}-check-results at ${url}.`, 'Log excerpts below are capped at 60 KB.']
for (const result of summary?.results ?? []) {
  excerpts.push(`\n--- ${result.name}: exit ${result.code} (${result.durationMs} ms) ---\n${readReportFile(`${result.name}.log`).slice(-Math.floor(55_000 / summary.results.length))}`)
}
if (!summary) excerpts.push('No check summary: failure occurred before the contract ran (checkout, install or setup). See the workflow log.')
const payload = JSON.stringify({ context: contexts[suite], state, description: `${suite} shared contract: ${state}`, targetUrl: url, log: excerpts.join('\n').slice(0, 60_000) })
const response = await fetch(`https://repos.openape.ai/api/repos/patrick/monorepo/statuses/${sha}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ape-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}` }, body: payload, signal: AbortSignal.timeout(30_000),
})
if (!response.ok) throw new Error(`Native status reporting failed: HTTP ${response.status}`)
console.log(`Reported ${contexts[suite]} ${state} for ${sha}`)
