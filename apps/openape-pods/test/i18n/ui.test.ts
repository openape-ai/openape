import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import LanguageSwitcher from '../../src/renderer/LanguageSwitcher.vue'
import ScriptCode from '../../src/renderer/ScriptCode.vue'
import PodNavigation from '../../src/renderer/PodNavigation.vue'
import { applyLanguage, language, number, dateTime } from '../../src/renderer/i18n'
import type { LanguageCommand } from '../../src/contracts/language'

afterEach(() => { applyLanguage('en') })
it('switches accessible labels and retained user content immediately without remounting', async () => {
  window.pods = { packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: vi.fn(async (command: LanguageCommand) => command.type === 'set' ? command.language : 'en') } as unknown as typeof window.pods
  const picker = mount(LanguageSwitcher)
  const editor = mount(ScriptCode, { props: { modelValue: 'const label = "Knowledge"; // unchanged' } })
  const navigation = mount(PodNavigation, { props: { pods: [{ id: 'pod', name: 'Knowledge', lifecycle: 'paused', revision: 1, activeScript: null }], podId: 'pod', organization: { revision: 1, groups: [] }, available: true, highlight: true } })
  await picker.get('select').setValue('de'); await flushPromises()
  expect(language.value).toBe('de'); expect(document.documentElement.lang).toBe('de')
  expect(editor.get('textarea').attributes('aria-label')).toBe('Skriptquelltext'); expect((editor.get('textarea').element as HTMLTextAreaElement).value).toContain('"Knowledge"')
  expect(navigation.text()).toContain('Knowledge'); expect(navigation.text()).toContain('pausiert'); expect(navigation.text()).toContain('Nicht gruppiert')
  expect(picker.get('select').attributes('aria-label')).toBe('Sprache')
  expect(number(150000)).toBe('150\u00A0000'); expect(dateTime('2026-09-13T12:00:00Z')).toContain('13.09.2026')
  await picker.get('select').setValue('en'); await flushPromises(); expect(editor.get('textarea').attributes('aria-label')).toBe('Script source'); expect(number(150000)).toBe('150,000')
  picker.unmount(); editor.unmount(); navigation.unmount()
})
it('keeps the previous language and presents a retryable error if persistence fails', async () => {
  window.pods = { packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: vi.fn().mockRejectedValue(new Error('Could not save language')) } as unknown as typeof window.pods
  const picker = mount(LanguageSwitcher); await picker.get('select').setValue('de'); await flushPromises()
  expect(language.value).toBe('en'); expect((picker.get('select').element as HTMLSelectElement).value).toBe('en'); expect(picker.get('[role="alert"]').text()).toBe('Could not save language')
  expect(picker.get('select').attributes('disabled')).toBeUndefined(); picker.unmount()
})
