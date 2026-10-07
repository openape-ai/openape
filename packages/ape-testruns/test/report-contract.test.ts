import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inspectHtml } from '@openape/report-contracts/html'
import { DomUtils, parseDocument } from 'htmlparser2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderReceipt } from '../src/render-receipt'
import { renderPlan } from '../src/render-plan'
import { renderTestRun } from '../src/render-test-run'
import { digest } from '../src/report-evidence'
import { planTextEntries } from '../src/plan-translations'
import { validateReport } from '../src/report-input'
import type { Plan, TestRun } from '../src/report-types'

const run: TestRun = { schema: 'openape.test-run/1', title: 'Verification', purpose: 'verification', tests: [{ id: 'check', title: 'Expected rejection', status: 'passed' }] }
const plan: Plan = { schema: 'openape.plan/2', title: 'Proposal', goal: 'Observe the result', status: 'draft', milestones: [{ id: 'observe', title: 'Observe', goal: 'Run experiment', status: 'planned', acceptance: ['Record the actual outcome'] }] }
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=', 'base64')
let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'report-contract-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })
const visible = (html: string) => DomUtils.textContent(DomUtils.getElementsByTagName('body', parseDocument(html))[0]!)

describe('versioned report contract', () => {
  it('keeps generated types consistent with the shipped schema', () => {
    execFileSync(process.execPath, ['scripts/report-contract-types.mjs', '--check'], { cwd: resolve(import.meta.dirname, '../../..') })
  })
  it('renders every shipped versioned example deterministically without network resources', () => {
    for (const name of ['test-run-minimal', 'test-run-characterization', 'plan-minimal', 'plan-completed-negative']) {
      const source = JSON.parse(readFileSync(new URL(`../examples/versioned/${name}.json`, import.meta.url), 'utf8'))
      const render = () => name.startsWith('plan') ? renderPlan(source) : renderTestRun(source, directory)
      const html = render()
      expect(render()).toBe(html)
      expect(inspectHtml(html).externalImages).toEqual([])
      expect(html).not.toContain('{{')
    }
  })
  it('renders bilingual Plans with a top summary and one shared evidence record', () => {
    const source = JSON.parse(readFileSync(new URL('../examples/versioned/plan-bilingual.json', import.meta.url), 'utf8'))
    source.evidence = [{ id: 'log', title: 'Original log', kind: 'text', role: 'evidence', text: 'Exact evidence 🦍' }]
    source.milestones[0].evidenceIds = ['log']
    const html = renderPlan(source)
    const document = parseDocument(html)
    expect(inspectHtml(html).language).toBe('de')
    expect(inspectHtml(html).metadata['plans.status']).toBe(source.status)
    expect(visible(html)).toContain('Das Problem auf einen Blick')
    expect(visible(html)).toContain('Problem at a glance')
    const originalStatements = DomUtils.findAll(element => element.name === 'div' && element.attribs.lang === 'en', document.children)
    expect(originalStatements.filter(element => DomUtils.textContent(element).trim() === source.approval.reference)).toHaveLength(2)
    expect(originalStatements.filter(element => DomUtils.textContent(element).trim() === source.approval.scope)).toHaveLength(2)
    expect(originalStatements.filter(element => DomUtils.textContent(element).trim() === source.decisions[0].reference)).toHaveLength(2)
    const ids = DomUtils.findAll(element => Boolean(element.attribs.id), document.children).map(element => element.attribs.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => id === 'evidence-log')).toHaveLength(1)
    expect(html.indexOf('class="plan-tldr"')).toBeLessThan(html.indexOf('class="state neutral"'))
    expect(renderReceipt('plan', Buffer.from(JSON.stringify(source)), html).resolvedEvidenceDigests).toEqual([{ id: 'log', digest: digest('Exact evidence 🦍') }])
    const embedded = DomUtils.getElementById('openape-plan-source', document.children)!
    expect(JSON.parse(DomUtils.textContent(embedded))).toEqual(source)
    expect(renderPlan(source)).toBe(html)
    source.translations.defaultLanguage = 'en'
    const english = renderPlan(source)
    expect(inspectHtml(english).language).toBe('en')
    expect(english.indexOf('class="plan-language plan-en"')).toBeLessThan(english.indexOf('class="plan-language plan-de"'))
    source.evidence = []
    delete source.milestones[0].evidenceIds
    expect(renderPlan(source)).not.toContain('class="page shared-records"')
  })
  it('rejects incomplete, stale or fact-changing translations before rendering', () => {
    const input = () => JSON.parse(readFileSync(new URL('../examples/versioned/plan-bilingual.json', import.meta.url), 'utf8'))
    const missing = input(); missing.translations.entries.pop()
    expect(() => renderPlan(missing)).toThrow(/Missing German/)
    const stale = input(); stale.goal = 'A different goal'
    expect(() => renderPlan(stale)).toThrow(/Stale translation/)
    const unknown = input(); unknown.translations.entries[0].path = 'approval.reference'
    expect(() => renderPlan(unknown)).toThrow(/Unknown translation/)
    const duplicate = input(); duplicate.translations.entries.push(duplicate.translations.entries[0])
    expect(() => renderPlan(duplicate)).toThrow(/Duplicate translation/)
    const overview = input(); delete overview.problem
    expect(() => renderPlan(overview)).toThrow(/summary and problem/)
    const language = input(); language.language = 'de'
    expect(() => renderPlan(language)).toThrow(/English source/)
    const title = input(); title.translations.entries[0].text = 'Invalid\tTitle'
    expect(() => renderPlan(title)).toThrow(/German plan fields/)
  })
  it('keeps authored anchor links local to their language and literal source text intact', () => {
    const source = JSON.parse(readFileSync(new URL('../examples/versioned/plan-bilingual.json', import.meta.url), 'utf8'))
    source.context = '[Milestone](#milestone-reading) and replacement \uFFFD'
    source.translations.entries.push({ path: 'context', source: source.context, text: '[Meilenstein](#milestone-reading) und Ersatzzeichen \uFFFD' })
    const html = renderPlan(source)
    expect(html).toContain('href="#en-milestone-reading"')
    expect(html).toContain('href="#de-milestone-reading"')
    expect(visible(html)).toContain('Ersatzzeichen \uFFFD')
    expect(planTextEntries(source).some(entry => entry.path.startsWith('approval.'))).toBe(false)
  })
  it('separates passing characterization, explicit adverse assessment and command exit 1', () => {
    const html = renderTestRun({ ...run, purpose: 'characterization', assessment: { outcome: 'action-required', summary: 'The unsafe behavior was reproduced.' }, commands: [{ id: 'audit', command: 'audit --fixture', outcome: 'exited', exitCode: 1, expectedExitCodes: [1] }] }, directory)
    expect(inspectHtml(html).metadata['tests.result']).toBe('passed')
    expect(visible(html)).toContain('action-required')
    expect(visible(html)).toContain('exit 1')
    expect(visible(html)).toContain('characterization report')
  })
  it('rejects inconsistent command durations while allowing recorded timestamp precision', () => {
    const command = { id: 'command', command: 'probe', outcome: 'exited', exitCode: 0, startedAt: '2026-10-07T10:00:00.000Z', finishedAt: '2026-10-07T10:00:01.000Z' }
    expect(() => validateReport({ ...run, commands: [{ ...command, durationMs: 1001 }] })).not.toThrow()
    expect(() => validateReport({ ...run, commands: [{ ...command, durationMs: 1002 }] })).toThrow(/duration contradicts/)
    expect(() => validateReport({ ...run, commands: [{ ...command, startedAt: '2026-10-07T10:00:00Z', finishedAt: '2026-10-07T10:00:01Z', durationMs: 1900 }] })).not.toThrow()
    expect(() => validateReport({ ...run, commands: [{ ...command, durationMs: -1 }] })).toThrow()
  })
  it('validates publication labels before rendering', () => {
    for (const input of [run, plan]) {
      for (const language of ['de_AT', 'en US']) expect(() => validateReport({ ...input, language })).toThrow(/schema/)
      for (const title of ['A\tB', 'A\nB', 'A\u007FB']) expect(() => validateReport({ ...input, title })).toThrow(/schema/)
      expect(() => validateReport({ ...input, language: 'de-AT' })).not.toThrow()
    }
  })
  it('preserves valid replacement characters and rejects NUL in text evidence', () => {
    const text = 'build \uFFFD output'
    writeFileSync(join(directory, 'log.txt'), text)
    for (const evidence of [{ text }, { path: 'log.txt' }]) {
      const input = { ...run, summary: text, evidence: [{ id: 'log', title: text, kind: 'text', role: 'evidence', ...evidence }] }
      const html = renderTestRun(input, directory)
      expect(visible(html)).toContain(text)
      expect(renderReceipt('test-run', Buffer.from(JSON.stringify(input)), html).resolvedEvidenceDigests).toContainEqual({ id: 'log', digest: digest(text) })
    }
    writeFileSync(join(directory, 'nul.txt'), 'bad\u0000log')
    for (const evidence of [{ text: 'bad\u0000log' }, { path: 'nul.txt' }]) {
      expect(() => renderTestRun({ ...run, evidence: [{ id: 'log', title: 'Log', kind: 'text', role: 'evidence', ...evidence }] }, directory)).toThrow(/Text evidence log contains NUL/)
    }
  })
  it('rejects unpaired surrogates before encoding while preserving paired Unicode', () => {
    expect(() => validateReport({ ...run, summary: 'a\uD800b' })).toThrow(/surrogate at report.summary/)
    expect(() => validateReport({ ...run, evidence: [{ id: 'log', title: 'Log', kind: 'text', role: 'evidence', text: '\uDC00' }] })).toThrow(/surrogate at report.evidence.0.text/)
    expect(visible(renderTestRun({ ...run, summary: 'Valid pair: 🦍' }, directory))).toContain('Valid pair: 🦍')
  })
  it('rejects approval digests contradicting a locally recorded artifact version', () => {
    expect(() => validateReport({ ...plan, approval: { by: 'Owner', date: '2026-10-07', reference: 'Approved the frozen source', target: { url: 'https://example.org/source', version: 1, sourceDigest: 'a'.repeat(64) } }, provenance: [{ url: 'https://example.org/source', format: 'plan JSON', version: 1, digest: 'b'.repeat(64) }] })).toThrow(/contradicts/)
  })
  it('derives failed before incomplete and counts checks rather than steps', () => {
    const incomplete: TestRun = { ...run, tests: [...run.tests, { id: 'wait', title: 'Device unavailable', status: 'blocked', reason: 'Device locked' }, { id: 'skip', title: 'Deferred', status: 'skipped', reason: 'Outside this increment' }] }
    expect(inspectHtml(renderTestRun(incomplete, directory)).metadata['tests.result']).toBe('incomplete')
    expect(inspectHtml(renderTestRun({ ...incomplete, tests: [...incomplete.tests, { id: 'fail', title: 'Mismatch', status: 'failed', observed: 'Unexpected response' }] }, directory)).metadata['tests.result']).toBe('failed')
    expect(() => renderTestRun({ ...run, tests: [{ ...run.tests[0], steps: [{ title: 'Incomplete child', status: 'skipped', caption: 'Unavailable' }] }] }, directory)).toThrow(/Passed check/)
  })
  it('does not publish acceptance metadata for sample/reference or a mixed/dirty target', () => {
    const sha = 'a'.repeat(40)
    const sourced: TestRun = { ...run, targets: [{ id: 'source', label: 'Source', kind: 'source', commit: sha }], tests: [{ ...run.tests[0]!, targetId: 'source' }] }
    expect(inspectHtml(renderTestRun(sourced, directory)).metadata['tests.commit']).toBe(sha)
    for (const input of [{ ...sourced, sample: true }, { ...sourced, purpose: 'reference' }]) {
      const html = renderTestRun(input, directory)
      expect(inspectHtml(html).metadata).toEqual({})
      expect(visible(html)).not.toContain('All recorded checks passed')
    }
    expect(inspectHtml(renderTestRun({ ...sourced, tests: [...sourced.tests, { id: 'unknown', title: 'No target', status: 'passed' }] }, directory)).metadata['tests.commit']).toBeUndefined()
    expect(inspectHtml(renderTestRun({ ...sourced, targets: [{ ...sourced.targets![0], dirty: true, changesDigest: 'b'.repeat(64) }] }, directory)).metadata['tests.commit']).toBeUndefined()
  })
  it('preserves a completed negative experiment and distinguishes older, unbound and artifact approvals', () => {
    const done = { ...plan, status: 'done', completion: { result: 'not-achieved', summary: 'The experiment concluded without improvement.' } }
    const html = renderPlan(done)
    expect(inspectHtml(html).metadata['plans.status']).toBe('done')
    expect(visible(html)).toContain('not-achieved')
    expect(visible(html)).toContain('Owner approval: not recorded')
    expect(() => renderPlan({ ...plan, status: 'done' })).toThrow(/completion/)
    const approval = { by: 'Owner', date: '2026-10-07', reference: 'Implement this proposal.' }
    expect(visible(renderPlan({ ...plan, approval }))).toContain('target unverified')
    expect(visible(renderPlan({ ...plan, revision: 2, approval: { ...approval, target: { revision: 1 } } }))).toContain('current revision not covered')
    expect(visible(renderPlan({ ...plan, revision: 2, approval: { ...approval, target: { revision: 2 } } }))).toContain('Approval recorded for this proposal revision')
    expect(visible(renderPlan({ ...plan, revision: 2, approval: { ...approval, target: { revision: 2, url: 'https://example.org/mock', version: 1 } } }))).toContain('current-source equivalence unverified')
  })
  it.each([
    { ...run, unknown: true },
    { ...run, tests: [{ ...run.tests[0], extra: 'unknown' }] },
    { ...run, tests: [run.tests[0], run.tests[0]] },
    { ...run, tests: [{ ...run.tests[0], evidenceIds: ['missing'] }] },
    { ...run, tests: [{ ...run.tests[0], commandIds: ['missing'] }] },
    { ...run, tests: [{ ...run.tests[0], targetId: 'missing' }] },
    { ...run, tests: [{ ...run.tests[0], status: 'blocked' }] },
    { ...run, tests: [{ ...run.tests[0], status: 'failed' }] },
    { ...run, startedAt: '2026-10-07T12:00:00' },
    { ...run, startedAt: '2026-02-30T12:00:00Z' },
    { ...run, startedAt: '2026-10-07T12:00:00Z', finishedAt: '2026-10-07T11:00:00Z' },
    { ...run, commands: [{ id: 'c', command: 'test', outcome: 'exited' }] },
    { ...run, commands: [{ id: 'c', command: 'test', outcome: 'timed-out', exitCode: 0 }] },
    { ...run, targets: [{ id: 's', label: 'Dirty', kind: 'source', dirty: true }] },
    { ...run, links: [{ title: 'Credentials', url: 'https://name:secret@example.org/' }] },
    { ...run, evidence: [{ id: 'text', title: 'Ambiguous', kind: 'text', role: 'evidence', path: 'log.txt', text: 'Inline' }] },
    { ...plan, milestones: [{ ...plan.milestones[0], status: 'blocked' }] },
  ])('rejects invalid input without dropping fields (%#)', (input) => {
    expect(() => validateReport(input)).toThrow()
  })
  it('embeds exact images/text, checks attestations, labels missing inspections and counts evidence roles', () => {
    writeFileSync(join(directory, 'image.png'), pixel)
    const text = '\uFEFFactual <script> & result\r\nsecond line'
    writeFileSync(join(directory, 'log.txt'), text)
    const input: TestRun = { ...run, evidence: [
      { id: 'shot', kind: 'image', title: 'Captured UI', caption: 'Actual rendered fixture', role: 'evidence', path: 'image.png', inspection: { by: 'Reviewer', at: '2026-10-07T10:00:00Z', result: 'matches', notes: 'Expected text is visible', digest: digest(pixel) } },
      { id: 'mock', kind: 'image', title: 'Design reference', caption: 'Not implementation evidence', role: 'mockup', path: 'image.png' },
      { id: 'log', kind: 'text', title: 'Output', role: 'evidence', path: 'log.txt' },
    ], tests: [{ ...run.tests[0]!, evidenceIds: ['shot', 'mock'], steps: [{ title: 'Same screenshot', evidenceIds: ['shot'] }] }] }
    const html = renderTestRun(input, directory)
    expect(html).toContain(`data:image/png;base64,${pixel.toString('base64')}`)
    expect(visible(html)).toContain('1 evidence images')
    expect(visible(html)).toContain('Inspection: not recorded')
    expect(visible(html)).toContain('1 inspection attestations recorded')
    const cli = resolve(import.meta.dirname, '../dist/render.mjs')
    writeFileSync(join(directory, 'input.json'), JSON.stringify(input))
    const receipt = JSON.parse(execFileSync(process.execPath, [cli, 'test-run', join(directory, 'input.json'), join(directory, 'output.html'), '--json'], { encoding: 'utf8' }))
    expect(receipt.resolvedEvidenceDigests).toContainEqual({ id: 'log', digest: digest(text) })
    expect(receipt.resolvedEvidenceDigests).toContainEqual({ id: 'shot', digest: digest(pixel) })
    expect(receipt.sourceFileDigest).toBe(digest(JSON.stringify(input)))
    expect(receipt.htmlDigest).toBe(digest(readFileSync(join(directory, 'output.html'))))
    writeFileSync(join(directory, 'image.png'), Buffer.concat([pixel, Buffer.from('changed')]))
    expect(() => renderTestRun(input, directory)).toThrow(/digest mismatch/)
  })
  it('rejects escaped paths, symlinks, oversized, invalid UTF-8 and disguised executable images before writing', () => {
    const input = (path: string, kind = 'text') => ({ ...run, evidence: [{ id: 'file', title: 'File', role: 'evidence', kind, path, ...(kind === 'image' ? { caption: 'Image' } : {}) }] })
    for (const path of ['../secret', '/etc/passwd', 'C:\\secret', 'a/../secret']) expect(() => renderTestRun(input(path), directory)).toThrow()
    symlinkSync('/etc', join(directory, 'outside'))
    expect(() => renderTestRun(input('outside/passwd'), directory)).toThrow(/escapes/)
    writeFileSync(join(directory, 'log.txt'), Buffer.from([255, 254]))
    expect(() => renderTestRun(input('log.txt'), directory)).toThrow()
    writeFileSync(join(directory, 'log.txt'), Buffer.alloc(1024 * 1024 + 1))
    expect(() => renderTestRun(input('log.txt'), directory)).toThrow(/1 MiB/)
    writeFileSync(join(directory, 'shot.png'), '<svg onload="alert(1)"></svg>')
    expect(() => renderTestRun(input('shot.png', 'image'), directory)).toThrow(/raster/)
    writeFileSync(join(directory, 'input.json'), JSON.stringify(input('missing.txt')))
    writeFileSync(join(directory, 'output.html'), 'preserved')
    const cli = resolve(import.meta.dirname, '../dist/render.mjs')
    expect(spawnSync(process.execPath, [cli, 'test-run', join(directory, 'input.json'), join(directory, 'output.html'), '--overwrite']).status).toBe(2)
    expect(readFileSync(join(directory, 'output.html'), 'utf8')).toBe('preserved')
  })
  it('preserves source and narrative placement without executable or remotely loaded content', () => {
    const hostile = '</script><script>alert(1)</script> $& {{styles}}'
    const html = renderPlan({ ...plan, title: hostile, sections: [{ id: 'before', title: 'Architecture', body: '| A | B |\n|---|---|\n| preserved | table |', placement: 'before-details' }, { id: 'after', title: 'Handoff details', body: hostile }] })
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('$&amp; {{styles}}')
    expect(html.indexOf('section-before')).toBeLessThan(html.indexOf('id="milestone-observe"'))
    expect(html.indexOf('id="section-after"')).toBeGreaterThan(html.indexOf('id="milestone-observe"'))
    expect(JSON.parse(html.match(/<script id="openape-plan-source" type="application\/json">(.*?)<\/script>/su)![1]!).title).toBe(hostile)
  })
})
