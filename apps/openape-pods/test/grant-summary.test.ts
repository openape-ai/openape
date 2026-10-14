// @vitest-environment node
import { expect, it } from 'vitest'
import { grantSummary, parseSummary, splitScriptSummary, summaryLine } from '../src/contracts/grant-summary'
import { translateDiagnostic } from '../src/i18n'

// Issue 1473: a script's summary of a call is passed through; it never becomes part of the call or its effect.
it('splits a script summary off a tool or HTTP call and leaves the call itself unchanged', () => {
  const call = { url: 'https://api.example.test/items', method: 'POST', key: 'item-1', body: '{}' }
  expect(splitScriptSummary(call)).toEqual({ payload: call })
  expect(splitScriptSummary({ ...call, summary: { title: 'Create the item', description: 'Line one\nLine two' } })).toEqual({ payload: call, summary: { title: 'Create the item', description: 'Line one\nLine two' } })
  for (const summary of [{ title: 'x'.repeat(121) }, { title: 'a‮b' }, { origin: 'Other Pod' }, { link: 'file:///etc/passwd' }, 'Create the item'])
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
