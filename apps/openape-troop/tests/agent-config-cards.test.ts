// @vitest-environment happy-dom
import type { Agent } from '../app/types/agent'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import AgentRecipeCard from '../app/components/AgentRecipeCard.vue'
import AgentSystemPromptCard from '../app/components/AgentSystemPromptCard.vue'
import AgentToolsCard from '../app/components/AgentToolsCard.vue'
import de from '../i18n/locales/de.json'

// The three cards that configure how an agent thinks: its system prompt, the
// recipe that can rewrite that prompt, and its tool whitelist. Assertions run
// against the shipped German catalog, so a renamed or missing key fails here.
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })

vi.stubGlobal('useI18n', () => i18n.global)

const apiFetch = vi.fn()
vi.stubGlobal('apiFetch', apiFetch)

const global = {
  plugins: [i18n],
  stubs: {
    UCard: { template: '<div><slot /></div>' },
    UBadge: { template: '<span><slot /></span>' },
    UButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
    UAlert: { props: ['title', 'description'], template: '<div>{{ title }} {{ description }}</div>' },
    UIcon: true,
    UFormField: { props: ['label'], template: '<label>{{ label }}<slot /></label>' },
    UInput: {
      props: ['modelValue'],
      template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
    },
    UTextarea: {
      props: ['modelValue'],
      template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    // The real picker fetches the tool catalog; here a button stands in for
    // ticking one more tool.
    ToolPicker: {
      props: ['modelValue', 'disabled'],
      template: '<button class="pick" @click="$emit(\'update:modelValue\', [...modelValue, \'mail.list\'])">{{ modelValue.join(",") }}</button>',
    },
  },
}

const agent: Agent = {
  email: 'zaz@delta-mind.at',
  ownerEmail: 'patrick@hofmann.eco',
  agentName: 'zaz',
  hostId: 'host-01KZ',
  hostname: 'chatty',
  pubkeySsh: 'ssh-ed25519 AAAAC3Nz',
  systemPrompt: 'Du bist zaz.',
  tools: ['shell.run'],
  paused: false,
  firstSeenAt: 1_785_000_000,
  lastSeenAt: 1_785_800_000,
  createdAt: 1_784_000_000,
}

function saveButton(card: ReturnType<typeof mount>) {
  return card.findAll('button').find(b => b.text() === 'Speichern')
}

describe('agent system prompt card', () => {
  beforeEach(() => { apiFetch.mockReset() })

  function mounted(a: Agent = agent) {
    return mount(AgentSystemPromptCard, { props: { agentName: 'zaz', agent: a }, global })
  }

  it('shows the stored prompt and marks it as set', () => {
    const card = mounted()
    expect(card.get('textarea').element.value).toBe('Du bist zaz.')
    expect(card.text()).toContain('gesetzt')
  })

  it('marks an agent without a prompt as empty', () => {
    expect(mounted({ ...agent, systemPrompt: '' }).text()).toContain('leer')
  })

  it('offers Speichern only once the draft differs', async () => {
    const card = mounted()
    expect(saveButton(card)).toBeUndefined()
    await card.get('textarea').setValue('Du bist zaz, aber knapper.')
    expect(card.text()).toContain('ungespeichert')
    expect(saveButton(card)).toBeDefined()
  })

  it('patches the agent and reports the saved prompt upward', async () => {
    apiFetch.mockResolvedValue({})
    const card = mounted()
    await card.get('textarea').setValue('Du bist zaz, aber knapper.')
    await saveButton(card)!.trigger('click')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz', {
      method: 'PATCH',
      body: { system_prompt: 'Du bist zaz, aber knapper.' },
    })
    expect(card.emitted('saved')).toEqual([['Du bist zaz, aber knapper.']])
  })

  it('saves when the textarea loses focus', async () => {
    apiFetch.mockResolvedValue({})
    const card = mounted()
    await card.get('textarea').setValue('Kurz und trocken.')
    await card.get('textarea').trigger('blur')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledOnce()
  })

  it('stays quiet when an untouched prompt loses focus', async () => {
    const card = mounted()
    await card.get('textarea').trigger('blur')
    await flushPromises()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('surfaces a failed save and keeps the typed draft', async () => {
    apiFetch.mockRejectedValue({ data: { statusMessage: 'nest offline' } })
    const card = mounted()
    await card.get('textarea').setValue('Kurz und trocken.')
    await saveButton(card)!.trigger('click')
    await flushPromises()
    expect(card.text()).toContain('nest offline')
    expect(card.get('textarea').element.value).toBe('Kurz und trocken.')
    expect(card.emitted('saved')).toBeUndefined()
  })

  it('falls back to a generic message when the failure carries none', async () => {
    apiFetch.mockRejectedValue({})
    const card = mounted()
    await card.get('textarea').setValue('Kurz und trocken.')
    await saveButton(card)!.trigger('click')
    await flushPromises()
    expect(card.text()).toContain('Speichern fehlgeschlagen')
  })

  it('re-seeds the draft when the page hands over a freshly loaded agent', async () => {
    const card = mounted()
    await card.get('textarea').setValue('Halbfertiger Entwurf.')
    await card.setProps({ agent: { ...agent, systemPrompt: 'Vom Server.' } })
    expect(card.get('textarea').element.value).toBe('Vom Server.')
    expect(card.text()).toContain('gesetzt')
  })
})

describe('agent recipe card', () => {
  beforeEach(() => { apiFetch.mockReset() })

  function mounted() {
    return mount(AgentRecipeCard, { props: { agentName: 'zaz' }, global })
  }

  async function applyWith(card: ReturnType<typeof mount>, ref = 'openape-ai/coding-agent@main') {
    await card.get('input').setValue(ref)
    await card.findAll('button').find(b => b.text() === 'Recipe setzen / aktualisieren')!.trigger('click')
    await flushPromises()
  }

  it('does not post without a recipe ref', async () => {
    const card = mounted()
    await card.findAll('button').find(b => b.text() === 'Recipe setzen / aktualisieren')!.trigger('click')
    await flushPromises()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('posts the trimmed ref together with the parsed params', async () => {
    apiFetch.mockResolvedValue({ ref: 'openape-ai/coding-agent@abc', agent: { systemPrompt: '' } })
    const card = mounted()
    await card.get('textarea').setValue('{"repo":"iurioServer"}')
    await applyWith(card, '  openape-ai/coding-agent@main  ')
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/agents/zaz/recipe', {
      method: 'POST',
      body: { repo_ref: 'openape-ai/coding-agent@main', params: { repo: 'iurioServer' } },
    })
  })

  it('re-reads the agent and reports the rewritten system prompt upward', async () => {
    apiFetch
      .mockResolvedValueOnce({ ref: 'openape-ai/coding-agent@abc', required_capabilities: [] })
      .mockResolvedValueOnce({ agent: { systemPrompt: 'Aus dem Recipe.' } })
    const card = mounted()
    await applyWith(card)
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/agents/zaz')
    expect(card.emitted('applied')).toEqual([['Aus dem Recipe.']])
  })

  it('names the capabilities that still need a secret', async () => {
    apiFetch
      .mockResolvedValueOnce({ ref: 'openape-ai/coding-agent@abc', required_capabilities: ['OPENAI_API_KEY'] })
      .mockResolvedValueOnce({ agent: { systemPrompt: '' } })
    const card = mounted()
    await applyWith(card)
    expect(card.text()).toContain('openape-ai/coding-agent@abc angewandt')
    expect(card.text()).toContain('Secrets binden: OPENAI_API_KEY')
  })

  it('says so when the recipe needs no new secrets', async () => {
    apiFetch
      .mockResolvedValueOnce({ ref: 'openape-ai/coding-agent@abc' })
      .mockResolvedValueOnce({ agent: { systemPrompt: '' } })
    const card = mounted()
    await applyWith(card)
    expect(card.text()).toContain('Keine neuen Secrets erforderlich.')
  })

  it('rejects malformed params before touching the API', async () => {
    const card = mounted()
    await card.get('textarea').setValue('nicht json')
    await applyWith(card)
    expect(apiFetch).not.toHaveBeenCalled()
    expect(card.text()).toContain('JSON')
    expect(card.emitted('applied')).toBeUndefined()
  })

  it('surfaces a failed apply', async () => {
    apiFetch.mockRejectedValue({ data: { statusMessage: 'recipe repo not found' } })
    const card = mounted()
    await applyWith(card)
    expect(card.text()).toContain('recipe repo not found')
  })

  it('falls back to a generic message when the failure carries none', async () => {
    apiFetch.mockRejectedValue({})
    const card = mounted()
    await applyWith(card)
    expect(card.text()).toContain('Recipe-Anwendung fehlgeschlagen')
  })
})

describe('agent tools card', () => {
  beforeEach(() => { apiFetch.mockReset() })

  function mounted(a: Agent = agent) {
    return mount(AgentToolsCard, { props: { agentName: 'zaz', agent: a }, global })
  }

  it('counts the whitelisted tools', () => {
    expect(mounted().text()).toContain('1 ausgewählt')
    expect(mounted({ ...agent, tools: [] }).text()).toContain('0 ausgewählt')
  })

  it('offers Speichern only once the selection changes', async () => {
    const card = mounted()
    expect(saveButton(card)).toBeUndefined()
    await card.get('button.pick').trigger('click')
    expect(card.text()).toContain('ungespeichert')
    expect(card.text()).toContain('2 ausgewählt')
    expect(saveButton(card)).toBeDefined()
  })

  it('ignores the order the tools come back in', async () => {
    const card = mounted({ ...agent, tools: ['mail.list', 'shell.run'] })
    await card.setProps({ agent: { ...agent, tools: ['shell.run', 'mail.list'] } })
    expect(card.text()).not.toContain('ungespeichert')
  })

  it('patches the whitelist and reports it upward', async () => {
    apiFetch.mockResolvedValue({})
    const card = mounted()
    await card.get('button.pick').trigger('click')
    await saveButton(card)!.trigger('click')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz', {
      method: 'PATCH',
      body: { tools: ['shell.run', 'mail.list'] },
    })
    expect(card.emitted('saved')).toEqual([[['shell.run', 'mail.list']]])
  })

  it('surfaces a failed save and keeps the selection', async () => {
    apiFetch.mockRejectedValue({ message: 'agent not enrolled' })
    const card = mounted()
    await card.get('button.pick').trigger('click')
    await saveButton(card)!.trigger('click')
    await flushPromises()
    expect(card.text()).toContain('agent not enrolled')
    expect(card.text()).toContain('2 ausgewählt')
    expect(card.emitted('saved')).toBeUndefined()
  })
})
