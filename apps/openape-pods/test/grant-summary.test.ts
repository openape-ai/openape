// @vitest-environment node
import { expect, it } from 'vitest'
import { grantSummary, parseSummary, savedScriptSummary, splitScriptSummary, summaryLine } from '../src/contracts/grant-summary'
import { parseRunContext } from '../src/contracts/services'
import { translateDiagnostic } from '../src/i18n'

// Issue 1473: a script's summary of a call is passed through; it never becomes part of the call or its effect.
it('splits approval presentation off a call and leaves the call itself unchanged', () => {
  const call = { url: 'https://api.example.test/items', method: 'POST', key: 'item-1', body: '{}' }
  expect(splitScriptSummary(call)).toEqual({ payload: call })
  expect(splitScriptSummary({ ...call, summary: { title: 'Create the item', description: 'Line one\nLine two' } })).toEqual({ payload: call, summary: { title: 'Create the item', description: 'Line one\nLine two' } })
  const batch = { id: 'selected-items', title: 'Review selected items', size: 2 }
  expect(splitScriptSummary({ ...call, batch })).toEqual({ payload: call, batch })
  expect(splitScriptSummary({ ...call, summary: { title: 'Create the item' }, batch })).toEqual({ payload: call, summary: { title: 'Create the item' }, batch })
  for (const invalid of [{ id: '' }, { ...batch, size: 101 }, { ...batch, description: 'Hidden\u202Etext' }, null]) expect(() => splitScriptSummary({ ...call, batch: invalid })).toThrow(/batch/i)
  for (const summary of [{ title: 'x'.repeat(121) }, { title: 'a‮b' }, { origin: 'Other Pod' }, { link: 'file:///etc/passwd' }, 'Create the item', undefined])
    expect(() => splitScriptSummary({ ...call, summary })).toThrow(/summary/i)
})

it('builds the summary from the script claim or from data, with the Pod as one bounded origin line', () => {
  expect(grantSummary('Push main to origin', 'Rebase Pod')).toEqual({ title: 'Push main to origin', origin: 'Rebase Pod' })
  expect(grantSummary('Push main to origin', 'Rebase\nPod⁦', { title: 'Publish the rebase', link: 'https://repos.example.test/pr/7' })).toEqual({ title: 'Publish the rebase', origin: 'Rebase Pod', link: 'https://repos.example.test/pr/7' })
  expect(summaryLine(`${'x'.repeat(130)}`, 120)).toBe(`${'x'.repeat(119)}…`)
  // A shortened line never splits a surrogate pair.
  expect(summaryLine(`${'x'.repeat(118)}😀😀`, 120)).toBe(`${'x'.repeat(118)}…`)
  expect(summaryLine(' ​ ', 120)).toBe('–')
  expect(parseSummary({ title: 'Publish', origin: 'Rebase Pod' })).toEqual({ title: 'Publish', origin: 'Rebase Pod' })
  expect(() => parseSummary({ description: 'No title' })).toThrow('summary.title')
  expect(() => parseSummary({ title: 'Publish', text: 'Legacy' })).toThrow('summary.text')
})

it('translates the protocol\'s summary refusals for the owner', () => {
  expect(translateDiagnostic('de', 'summary.title must be at most 120 characters')).toBe('summary.title darf höchstens 120 Zeichen haben')
  expect(translateDiagnostic('de', 'summary.description must not contain control or format characters other than line feeds')).toBe('summary.description darf außer Zeilenumbrüchen keine Steuer- oder Formatzeichen enthalten')
})

it('identifies saved-script launches without claiming that Pod context proves their effects', () => {
  const context = parseRunContext({ name: 'Invoice review', reason: 'schedule', description: 'Organizes invoices.\nMay submit payments.' })
  const summary = savedScriptSummary(context)
  expect(summary).toEqual({ title: 'Run saved script: Invoice review', origin: 'Invoice review', description: 'Pod context:\nOrganizes invoices. May submit payments.\n\nScheduled start. Tool and HTTP calls require their own permissions.' })
  expect(savedScriptSummary(parseRunContext({ name: 'Selected Pod', reason: 'manual' }))).toEqual({ title: 'Run saved script: Selected Pod', origin: 'Selected Pod', description: 'Run the selected saved script.\nManual start.' })
  const bounded = savedScriptSummary(parseRunContext({ name: '😀'.repeat(50), reason: 'event', description: `Context\twith\u202Ehidden markers ${'😀'.repeat(1900)}` }))
  expect(parseSummary(bounded)).toEqual(bounded)
  expect([...bounded.title].length).toBeLessThanOrEqual(120)
  expect([...bounded.description!].length).toBeLessThanOrEqual(2000)
  expect(bounded.description).toContain('Event-triggered start')
  expect(bounded.description).not.toMatch(/[\t\u202E]/u)
  expect(bounded.description).toContain('…')
})

it('validates optional run context while accepting older workers without a description', () => {
  const legacy = { name: 'Selected Pod', reason: 'manual' }
  expect(parseRunContext(legacy)).toEqual(legacy)
  for (const value of [{ ...legacy, description: null }, { ...legacy, description: 'x'.repeat(4001) }, { ...legacy, reason: 'unknown' }, { ...legacy, title: 'Injected purpose' }, []]) expect(() => parseRunContext(value)).toThrow('run context')
})

it('separates an opaque reference from program arguments without interpreting its client syntax', () => {
  const call = { application: 'exporter', argv: ['render', '42'] }
  expect(splitScriptSummary({ ...call, reference: 'invoice/42/export:v1' })).toEqual({ payload: call, reference: 'invoice/42/export:v1' })
  expect(() => splitScriptSummary({ ...call, reference: 'hidden\u202Evalue' })).toThrow(/reference/)
})
