// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, expect, it } from 'vitest'
import InboxPushSetting from '../app/components/InboxPushSetting.vue'
import { chooseLanguage } from '../app/inbox/i18n'

beforeEach(() => chooseLanguage('de'))
const setting = (state: 'on' | 'off' | 'denied' | 'unavailable', online = true, busy = false) => mount(InboxPushSetting, { props: { state, online, busy } })

it('offers to turn notifications on, and off again once active', async () => {
  const off = setting('off')
  expect(off.text()).toContain('Aus')
  await off.get('button').trigger('click')
  expect(off.emitted('toggle')).toHaveLength(1)
  const on = setting('on')
  expect(on.text()).toContain('An – Hinweise und Zähler am App-Symbol')
  expect(on.get('button').text()).toBe('Benachrichtigungen ausschalten')
})

it('explains instead of offering a button when the device cannot or may not, and while offline or busy', () => {
  expect(setting('denied').find('button').exists()).toBe(false)
  expect(setting('denied').text()).toContain('in den Systemeinstellungen änderbar')
  expect(setting('unavailable').text()).toContain('Nur in der installierten App verfügbar')
  expect(setting('off', false).find('button').exists()).toBe(false)
  expect(setting('off', true, true).get('button').attributes('disabled')).toBeDefined()
})
