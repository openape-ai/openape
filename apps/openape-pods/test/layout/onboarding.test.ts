import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { OnboardingView } from '../../src/contracts/onboarding'
import { installWorkspace, podId } from './workspace-fixture'

// Geometry formerly asserted by the packaged `onboarding` and `data` E2E files.
// Account, consent and backup behaviour lives in test/onboarding, test/data and
// test/main; here only whether those views fit.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const owner = '00000000-0000-4000-8000-0000000000e1'
const accounts: OnboardingView = {
  connections: [
    { id: owner, provider: 'openape', account: 'original.owner.with.a.long.address@example.invalid', state: 'ready', error: null, login: null },
    { id: '00000000-0000-4000-8000-0000000000e2', provider: 'chatgpt', account: 'model.account@example.invalid', state: 'ready', error: null, login: null },
  ],
  owner, runtime: { ready: true, error: null }, complete: true,
  podIdentity: { podId, bound: true, ownerConnection: owner, issuer: 'https://pods.example.invalid', decisionIssuer: 'https://identity.example.invalid', subject: 'invoice-agent-with-a-long-identifier@pods.example.invalid', brokerConnectionId: null },
} as OnboardingView
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en') })

async function open() {
  installWorkspace({ onboarding: async () => structuredClone(accounts) })
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
}
async function show(width: number, height: number, scheme: 'light' | 'dark') {
  await page.viewport(width, height); document.documentElement.style.colorScheme = scheme; await frame()
}
async function click(selector: string, text?: string) {
  const target = text ? wrapper!.findAll(selector).find(item => item.text().trim() === text) : wrapper!.find(selector)
  if (!target?.exists()) throw new Error(`Missing ${selector} ${text ?? ''}`)
  await target.trigger('click'); await flushPromises(); await frame()
}
const pageFits = () => document.documentElement.scrollWidth <= innerWidth

describe('accounts, identity and data views with the production stylesheet', () => {
  it.each([['en', 'Your accounts', 'Data & backups'], ['de', 'Deine Konten', 'Daten & Sicherungen']] as const)('fit a narrow dark window (%s)', async (language, accountsLabel, dataLabel) => {
    applyLanguage(language)
    await open()
    await show(560, 840, 'dark')
    for (const target of [accountsLabel, dataLabel]) {
      await click('.nav-button[aria-label]')
      expect(wrapper!.find('input[type="password"]').exists()).toBe(true)
      wrapper!.get('.jev-connection').element.scrollIntoView({ block: 'center' }); await frame()
      expect(pageFits(), `${language} settings`).toBe(true)
      await page.screenshot({ path: `../../.artifacts/jev-settings-${language}.png` })
      await click('button', target)
      expect(document.querySelector('h1, h2')).not.toBeNull()
      expect(pageFits(), `${language} ${target}`).toBe(true)

    }
    await click('.pod-button')
    await click('[role="tab"]', language === 'en' ? 'Settings' : 'Einstellungen')
    expect(document.querySelector('[aria-label="Pod identity"], [aria-label="Pod-Identität"]')).not.toBeNull()
    expect(pageFits(), `${language} pod identity`).toBe(true)
  })

  it('keeps the account avatar visible when the sidebar is collapsed', async () => {
    await open()
    await show(1060, 850, 'light')
    await click('button[aria-label="Collapse sidebar"]')
    await expect.poll(() => document.querySelector('.account-avatar')!.textContent).toBe('O')
    const avatar = document.querySelector('.account-avatar')!.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect()
    expect(avatar.width).toBeGreaterThan(0)
    expect(avatar.right).toBeLessThanOrEqual(sidebar.right)
  })
})
