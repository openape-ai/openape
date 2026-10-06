import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SecretForm from '../../src/renderer/central/SecretForm.vue'
import { applyLanguage } from '../../src/renderer/i18n'

// The three ways of giving a Pod a secret and what each one emits; the value stays inside the event.
const podId = '00000000-0000-4000-8000-000000000001'
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
async function mountForm(props: Record<string, unknown> = {}) {
  applyLanguage('de')
  wrapper = mount(SecretForm, { attachTo: document.body, props: { podId, alias: null, desktop: true, ...props } })
  await flushPromises()
  return wrapper
}
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)!
const way = (text: string) => wrapper!.findAll('.seg button').find(item => item.text().trim() === text)!

describe('Secret form', () => {
  it('offers the three ways with the assurance sentence and saves a typed value under a valid alias', async () => {
    await mountForm()
    expect(wrapper!.findAll('.seg button').map(item => [item.text(), item.attributes('aria-pressed')])).toEqual([['Eintippen', 'true'], ['Aus Datei', 'false'], ['Aus OpenApe Secrets', 'false']])
    expect(wrapper!.text()).toContain('Verschlüsselt auf diesem Mac, nur für diesen Pod. Nie in Backups, nie in Codex, nie im Chat.')
    expect(wrapper!.find('input[type="password"]').attributes('placeholder')).toBe('wird nach dem Speichern geleert')
    await wrapper!.find('form').trigger('submit')
    expect(wrapper!.find('[role="alert"]').text()).toContain('Kleinbuchstaben')
    await wrapper!.findAll('input')[0]!.setValue('Telegram Token')
    await wrapper!.find('form').trigger('submit')
    expect(wrapper!.find('[role="alert"]').text()).toContain('Kleinbuchstaben'); expect(wrapper!.emitted('save')).toBeUndefined()
    await wrapper!.findAll('input')[0]!.setValue('telegram_bot_token')
    await wrapper!.find('form').trigger('submit')
    expect(wrapper!.find('[role="alert"]').text()).toBe('Wert eingeben')
    await wrapper!.find('input[type="password"]').setValue('7391:AAH')
    await button('Speichern').trigger('click')
    expect(wrapper!.emitted('save')).toEqual([[podId, 'telegram_bot_token', '7391:AAH']])
    expect((wrapper!.find('input[type="password"]').element as HTMLInputElement).value).toBe('')
  })

  it('asks for a private file or raises a request with a purpose, prefilled with the alias to replace', async () => {
    await mountForm({ alias: 'zaz_agent_key' })
    expect((wrapper!.findAll('input')[0]!.element as HTMLInputElement).value).toBe('zaz_agent_key')
    await way('Aus Datei').trigger('click')
    expect(wrapper!.text()).toContain('Die App liest die Datei selbst, z. B. einen PEM-Schlüssel.')
    await button('Datei wählen…').trigger('click')
    expect(wrapper!.emitted('file')).toEqual([[podId, 'zaz_agent_key']])
    await way('Aus OpenApe Secrets').trigger('click')
    expect(wrapper!.text()).toContain('Pods ist als Maschine bei secrets.openape.ai registriert.')
    await wrapper!.findAll('input')[1]!.setValue('  Agent key for zaz  ')
    await button('Anfragen').trigger('click')
    expect(wrapper!.emitted('request')).toEqual([[podId, 'zaz_agent_key', 'Agent key for zaz']])
    await button('Abbrechen').trigger('click')
    expect(wrapper!.emitted('cancel')).toHaveLength(1)
  })

  it('shows the ways in the browser but keeps every input and the submit on the desktop', async () => {
    await mountForm({ desktop: false })
    expect(wrapper!.findAll('input').every(item => item.attributes('disabled') !== undefined)).toBe(true)
    expect(button('Speichern').attributes('disabled')).toBeDefined()
    expect(button('Speichern').attributes('title')).toBe('Nur am Desktop')
  })
})
