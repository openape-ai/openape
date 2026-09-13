import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parseLanguageCommand, systemLanguage } from '../../src/contracts/language'
import { LanguagePreference } from '../../src/main/language'
import { translate, translateDiagnostic } from '../../src/i18n'
import de from '../../src/i18n/de.json'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
it('selects German only for German systems and persists an explicit choice independently of system changes', () => {
  expect(['de', 'de-AT', 'de-DE', 'DE_ch'].map(systemLanguage)).toEqual(['de', 'de', 'de', 'de'])
  expect(['en-GB', 'fr-FR', '', 'den'].map(systemLanguage)).toEqual(['en', 'en', 'en', 'en'])
  const root = mkdtempSync(join(tmpdir(), 'pods-language-')); directories.push(root)
  const preference = new LanguagePreference(root, 'de-AT'); expect(preference.language).toBe('de')
  preference.set('en'); expect(JSON.parse(readFileSync(join(root, 'language.json'), 'utf8'))).toBe('en')
  expect(new LanguagePreference(root, 'de-DE').language).toBe('en')
  new LanguagePreference(root, 'de-DE').set('de'); expect(new LanguagePreference(root, 'en-US').language).toBe('de')
})
it('rejects malformed preferences and commands instead of widening the settings boundary', () => {
  for (const input of [null, [], {}, { type: 'get', path: '/tmp' }, { type: 'set', language: 'fr' }, { type: 'set', language: 'en', extra: true }]) expect(() => parseLanguageCommand(input)).toThrow()
  expect(parseLanguageCommand({ type: 'set', language: 'de' })).toEqual({ type: 'set', language: 'de' })
  const root = mkdtempSync(join(tmpdir(), 'pods-language-')); directories.push(root); writeFileSync(join(root, 'language.json'), '"invalid"')
  expect(() => new LanguagePreference(root, 'en')).toThrow('Unsupported language')
})
it('keeps every German catalog message and placeholder complete and preserves parameter content literally', () => {
  for (const [key, value] of Object.entries(de)) {
    expect(value.trim(), key).not.toBe('')
    expect(value.match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(key.match(/\{\w+\}/g)?.sort() ?? [])
  }
  expect(translate('de', 'Group for {p0}', { p0: '<script>{p0} Order</script>' })).toBe('Gruppe für <script>{p0} Order</script>')
  expect(() => translate('en', 'Group for {p0}')).toThrow('Missing translation parameter')
  expect(translateDiagnostic('de', 'Error invoking remote method \'pods:workspace\': Error: Groups changed. Refresh and try again.')).toBe('Gruppen wurden geändert. Aktualisiere und versuche es erneut.')
  expect(translateDiagnostic('en', 'External message <unsafe>')).toBe('External message <unsafe>')
  expect(translateDiagnostic('de', 'External message <unsafe>')).toBe('Technische Meldung (Original): External message <unsafe>')
})
