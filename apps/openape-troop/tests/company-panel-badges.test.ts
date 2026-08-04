// @vitest-environment happy-dom
import type { Mock } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import Memory from '../app/components/company/Memory.vue'
import Reports from '../app/components/company/Reports.vue'
import { apiFetch } from '../app/utils/api'

// Both panels used to print the raw enum the API sends ('auto', 'weekly') into a
// badge although the label map sat two functions further up. This test mounts
// them against the real locale files, so it fails again if a badge stops going
// through the map — or if one of the labels loses its translation.
vi.mock('../app/utils/api', () => ({ apiFetch: vi.fn() }))
const fetched = apiFetch as unknown as Mock

const messages = {
  de: JSON.parse(readFileSync(join(import.meta.dirname, '../i18n/locales/de.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(import.meta.dirname, '../i18n/locales/en.json'), 'utf8')),
}

// Nuxt UI is auto-imported in the app; stubbed here so assertions read text.
const stubs = {
  UInput: { props: ['modelValue'], template: '<input>' },
  UTextarea: { props: ['modelValue'], template: '<textarea>' },
  USelect: { props: ['modelValue'], template: '<select></select>' },
  UButton: { template: '<button><slot /></button>' },
  UAlert: { props: ['title'], template: '<div>{{ title }}</div>' },
  UBadge: { template: '<span class="badge"><slot /></span>' },
  UModal: { template: '<div><slot name="content" /></div>' },
  UFormField: { props: ['label'], template: '<div>{{ label }}<slot /></div>' },
  MarkdownText: { props: ['content'], template: '<div>{{ content }}</div>' },
}

function mountWith(component: unknown, locale: string) {
  const i18n = createI18n({ legacy: false, locale, messages })
  // The panels reach for these through Nuxt's auto-imports.
  vi.stubGlobal('useI18n', () => i18n.global)
  vi.stubGlobal('useDateFormat', () => ({ fmtDate: () => '01.01.2026' }))
  return mount(component as never, { props: { orgId: 'org-1' }, global: { stubs, plugins: [i18n] } })
}

const badges = (wrapper: ReturnType<typeof mountWith>) => wrapper.findAll('.badge').map(b => b.text())

describe('memory panel — the mode badge', () => {
  it.each([['de', 'Automatisch (nach Größe)'], ['en', 'Automatic (by size)']])('names the mode in %s', async (locale, expected) => {
    fetched.mockResolvedValue([{ id: 'a', scope: 'company', targetId: '', title: 'Ablage', body: 'x', mode: 'auto', updatedAt: 0 }])

    const wrapper = mountWith(Memory, locale)
    await flushPromises()

    expect(badges(wrapper)).toContain(expected)
    expect(badges(wrapper)).not.toContain('auto')
  })
})

describe('reports panel — the kind badge', () => {
  it.each([['de', 'Wöchentlich'], ['en', 'Weekly']])('names the kind in %s', async (locale, expected) => {
    fetched.mockResolvedValue([{ id: 'r', kind: 'weekly', title: 'KW 32', bodyMd: 'x', createdAt: 1 }])

    const wrapper = mountWith(Reports, locale)
    await flushPromises()

    expect(badges(wrapper)).toEqual([expected])
  })
})
