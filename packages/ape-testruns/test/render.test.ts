import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DomUtils, parseDocument } from 'htmlparser2'
import { inspectHtml } from '@openape/report-contracts/html'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderPlan } from '../src/render-plan'
import { renderTestRun } from '../src/render-test-run'

const plan = JSON.parse(readFileSync(new URL('../examples/plan.json', import.meta.url), 'utf8'))
const run = JSON.parse(readFileSync(new URL('../examples/testrun.json', import.meta.url), 'utf8'))
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=', 'base64')
let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'report-render-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('portable report templates', () => {
  it('renders both existing manifest data and structured plans into valid deterministic single HTML', () => {
    const testHtml = renderTestRun(run, directory, { commit: 'abc123', command: 'pnpm test' })
    expect(inspectHtml(testHtml)).toMatchObject({ category: 'Test Runs', metadata: { 'tests.result': 'failed', 'tests.commit': 'abc123' }, externalImages: [] })
    expect(testHtml).toContain('1</span><span class="metric-label">Not run')
    const summaries = DomUtils.getElementsByTagName('summary', parseDocument(testHtml)).map(element => DomUtils.textContent(element))
    expect(summaries[0]).toContain('Revoked access')
    expect(testHtml).toContain('2m 34s')
    const html = renderPlan(plan)
    expect(inspectHtml(html)).toMatchObject({ category: 'Plans', metadata: { 'plans.status': 'draft' }, externalImages: [] })
    expect(renderPlan(plan)).toBe(html)
    expect(html).toContain('Not recorded')
    expect(renderPlan({ ...plan, status: 'done' })).toContain('Not recorded')
  })
  it('escapes hostile text and embedded source without introducing executable HTML or external images', () => {
    const hostile = '</script><script>alert(1)</script><img src="https://example.org/leak"> $& {{styles}}'
    const html = renderPlan({ ...plan, title: hostile, goal: `${hostile}\n\n[bad](javascript:alert(1))\n\n![leak](https://example.org/leak)` })
    const inspected = inspectHtml(html)
    expect(inspected.externalImages).toEqual([])
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<img')
    expect(html).toContain('$&amp; {{styles}}')
    const embedded = html.match(/<script id="openape-plan-source" type="application\/json">(.*?)<\/script>/su)?.[1]
    expect(JSON.parse(embedded ?? '').title).toBe(hostile)
  })
  it('preserves code evidence and readable local links without invalid publication resources', () => {
    const error = '`expected "<div>"`\n\n```text\nactual <span> & "value"\n```\n\nGET http://localhost:3000/api failed; [spec](docs/check.md)'
    const html = renderTestRun({ title: 'Exact evidence', tests: [{ id: 'failure', title: 'Markup assertion', status: 'failed', error }] }, directory)
    expect(inspectHtml(html).externalImages).toEqual([])
    const code = DomUtils.getElementsByTagName('code', parseDocument(html)).map(element => DomUtils.textContent(element))
    expect(() => renderTestRun({ title: 'Unknown evidence', tests: [{ id: 'one', title: 'Test', status: 'passed', steps: [{ title: 'Screenshot', image: 'shot.png' }] }] }, directory)).toThrow(/Unknown.*image/i)
    expect(code).toContain('expected "<div>"')
    expect(code).toContain('actual <span> & "value"\n')
    expect(html).not.toContain('href="http://localhost')
    expect(html).not.toContain('href="docs/check.md')
    expect(() => renderTestRun({ title: 'Invalid steps', tests: [{ id: 'one', title: 'Steps', status: 'passed', steps: {} }] }, directory)).toThrow(/steps must be an array/)
  })
  it('embeds raster screenshots and fails for missing, mismatched, oversized or escaping evidence', () => {
    const manifest = { title: 'Evidence', tests: [{ id: 'one', title: 'Visible result', status: 'passed', steps: [{ title: 'The actual screenshot', shot: 'shot.png' }] }] }
    expect(() => renderTestRun(manifest, directory)).toThrow()
    writeFileSync(join(directory, 'shot.png'), pixel)
    const html = renderTestRun(manifest, directory)
    expect(html).toContain(`data:image/png;base64,${pixel.toString('base64')}`)
    expect(inspectHtml(html).externalImages).toEqual([])
    writeFileSync(join(directory, 'shot.png'), '<svg onload="alert(1)"></svg>')
    expect(() => renderTestRun(manifest, directory)).toThrow(/bytes do not match/)
    writeFileSync(join(directory, 'shot.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
    expect(() => renderTestRun(manifest, directory)).toThrow(/8 MiB/)
    manifest.tests[0]!.steps[0]!.shot = '../outside.png'
    expect(() => renderTestRun(manifest, directory)).toThrow(/relative image path/)
    const external = mkdtempSync(join(tmpdir(), 'report-external-'))
    try {
      writeFileSync(join(external, 'secret.png'), pixel)
      symlinkSync(external, join(directory, 'outside'))
      manifest.tests[0]!.steps[0]!.shot = 'outside/secret.png'
      expect(() => renderTestRun(manifest, directory)).toThrow(/escapes the input directory/)
    }
    finally { rmSync(external, { recursive: true, force: true }) }
  })
  it('rejects invalid schemas, missing acceptance, duplicate test ids and reversed timestamps', () => {
    expect(() => renderPlan({ ...plan, miletones: [] })).toThrow(/miletones is not supported/)
    expect(() => renderPlan({ ...plan, schema: 'openape.plan/2' })).toThrow(/schema/)
    expect(() => renderPlan({ ...plan, milestones: [{ ...plan.milestones[0], acceptance: [] }] })).toThrow(/acceptance/)
    expect(() => renderPlan({ ...plan, approval: { by: 'Owner' } })).toThrow(/approval.date/)
    expect(() => renderPlan({ ...plan, links: [{ title: 'Unsafe', url: 'javascript:alert(1)' }] })).toThrow(/HTTPS/)
    expect(() => renderTestRun({ ...run, tests: [run.tests[0], run.tests[0]] }, directory)).toThrow(/Duplicate/)
    expect(() => renderTestRun({ ...run, finishedAt: '2020-01-01' }, directory)).toThrow(/ordered timestamps/)
    expect(() => renderTestRun({ ...run, title: ' ' }, directory)).toThrow(/required/)
  })
  it('keeps skipped checks visible without claiming full acceptance', () => {
    const html = renderTestRun({ ...run, tests: run.tests.filter((test: { status: string }) => test.status !== 'failed') }, directory)
    expect(inspectHtml(html).metadata['tests.result']).toBe('incomplete')
    expect(html).toContain('Verification incomplete')
    expect(html).not.toContain('All checks passed')
  })
  it('runs the installed-style CLI without login and refuses accidental overwrite', () => {
    const cli = resolve(import.meta.dirname, '../dist/render.mjs')
    const input = join(directory, 'plan.json'); const output = join(directory, 'plan.html')
    writeFileSync(input, JSON.stringify(plan))
    const receipt = execFileSync(process.execPath, [cli, 'plan', input, output, '--json'], { encoding: 'utf8' })
    expect(JSON.parse(receipt)).toMatchObject({ published: false, kind: 'plan', output })
    expect(inspectHtml(readFileSync(output, 'utf8')).category).toBe('Plans')
    expect(spawnSync(process.execPath, [cli, 'plan', input, output]).status).toBe(2)
    expect(spawnSync(process.execPath, [cli, 'plan', input, output, '--overwrite']).status).toBe(0)
  })
})
