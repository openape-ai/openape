// @vitest-environment happy-dom
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationPolicyCard from '../app/components/AutomationPolicyCard.vue'
import { BUCKET_DISPLAY } from '../app/utils/audience-buckets'

const COMMANDS = BUCKET_DISPLAY.find(b => b.id === 'commands')!

const USwitchStub = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template: '<input type="checkbox" data-switch :checked="modelValue" @change="$emit(\'update:modelValue\', !modelValue)" />',
})

const stubs = {
  UIcon: { template: '<i />' },
  UBadge: { props: ['label'], template: '<span>{{ label }}<slot /></span>' },
  UAlert: { props: ['title', 'description'], template: '<div>{{ title }} {{ description }}<slot /></div>' },
  UButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  USelect: { props: ['modelValue'], emits: ['update:modelValue'], template: '<select />' },
  UInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  UFormField: { props: ['label', 'help'], template: '<label>{{ label }}<slot /></label>' },
  USwitch: USwitchStub,
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    agentEmail: 'op@id.openape.ai',
    audience: 'ape-shell',
    mode: 'deny-list',
    enabledBy: 'sync@troop.openape.ai',
    denyRiskThreshold: null,
    denyPatterns: ['*mail send*'],
    allowPatterns: ['o365-cli calendar *'],
    enabledAt: 1_755_000_000,
    expiresAt: null,
    updatedAt: 1_755_700_000,
    ...overrides,
  }
}

function mountCard(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('apiFetch', fetchMock)
  return mount(AutomationPolicyCard, {
    props: { agentEmail: 'op@id.openape.ai', bucket: COMMANDS },
    global: { stubs },
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('AutomationPolicyCard', () => {
  it('shows both lists with stable meaning when Vollautomatik is on', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('audience=ape-shell')) return { policy: policy() }
      return { policy: null }
    })
    const card = mountCard(fetchMock)
    await flushPromises()

    expect(card.text()).toContain('Vollautomatik')
    expect(card.text()).toContain('Alles wird automatisch erlaubt')
    expect(card.text()).toContain('Immer blockiert')
    expect(card.text()).toContain('Ohne Rückfrage erlaubt')
    // The allow list is inactive but never hidden or re-labeled.
    expect(card.text()).toContain('Inaktiv, solange Vollautomatik an ist')
    const values = card.findAll('input:not([data-switch])').map(i => (i.element as HTMLInputElement).value)
    expect(values).toContain('*mail send*')
    expect(values).toContain('o365-cli calendar *')
  })

  it('defaults to everything-asks when no policy exists', async () => {
    const card = mountCard(vi.fn(async () => ({ policy: null })))
    await flushPromises()

    expect(card.text()).toContain('jede Aktion braucht deine Freigabe')
    expect(card.text()).toContain('Keine Blockregeln')
    expect(card.text()).toContain('Keine Patterns — jede Anfrage wartet auf dich')
    expect(card.text()).not.toContain('YOLO')
  })

  it('warns that a restriction-less Vollautomatik is a server-side no-op', async () => {
    const card = mountCard(vi.fn(async () => ({ policy: null })))
    await flushPromises()

    expect(card.text()).not.toContain('Wirkungslos')
    await card.find('[data-switch]').trigger('change')
    expect(card.text()).toContain('Wirkungslos ohne Einschränkung')
  })

  it('saves both lists and maps Vollautomatik to the wire mode', async () => {
    const puts: Array<{ url: string, body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
      if (opts?.method === 'PUT') {
        puts.push({ url, body: opts.body! })
        return { ok: true }
      }
      if (url.includes('audience=ape-shell')) return { policy: policy() }
      return { policy: null }
    })
    const card = mountCard(fetchMock)
    await flushPromises()

    await card.findAll('button').find(b => b.text() === 'Speichern')!.trigger('click')
    await flushPromises()

    expect(puts).toHaveLength(COMMANDS.audiences.length)
    for (const put of puts) {
      expect(put.body).toMatchObject({
        mode: 'deny-list',
        denyPatterns: ['*mail send*'],
        allowPatterns: ['o365-cli calendar *'],
      })
    }
  })

  it('shows who wrote the policy and that syncs overwrite manual edits', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('audience=ape-shell')) return { policy: policy() }
      return { policy: null }
    })
    const card = mountCard(fetchMock)
    await flushPromises()

    expect(card.text()).toContain('Zuletzt gesetzt von sync@troop.openape.ai')
    expect(card.text()).toContain('überschreiben Handänderungen')
  })
})
