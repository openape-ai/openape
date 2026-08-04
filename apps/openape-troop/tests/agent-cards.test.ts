// @vitest-environment happy-dom
import type { Agent, Run } from '../app/types/agent'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import AgentMetaCard from '../app/components/AgentMetaCard.vue'
import AgentRunsCard from '../app/components/AgentRunsCard.vue'
import AgentSecretsCard from '../app/components/AgentSecretsCard.vue'
import AgentSkillsCard from '../app/components/AgentSkillsCard.vue'
import { useDateFormat } from '../app/composables/useDateFormat'
import { useRelativeTime } from '../app/composables/useRelativeTime'
import de from '../i18n/locales/de.json'

// The cards read the shipped German catalog, so the assertions below are on the
// strings a user actually sees — a renamed or missing key fails the test.
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })

// Nuxt auto-imports resolve as globals here; the app injects the real ones.
vi.stubGlobal('useI18n', () => i18n.global)
vi.stubGlobal('useDateFormat', useDateFormat)
vi.stubGlobal('useRelativeTime', useRelativeTime)

const apiFetch = vi.fn()
vi.stubGlobal('apiFetch', apiFetch)

const confirmDialog = vi.fn(() => true)
vi.stubGlobal('confirm', confirmDialog)

const global = {
  plugins: [i18n],
  stubs: {
    UCard: { template: '<div><slot /></div>' },
    UAlert: { props: ['title'], template: '<div>{{ title }}</div>' },
    UBadge: { template: '<span><slot /></span>' },
    UButton: { props: ['ariaLabel'], template: '<button><slot />{{ ariaLabel }}</button>' },
    UModal: { props: ['open'], template: '<div v-if="open"><slot name="content" /></div>' },
    UFormField: { props: ['label'], template: '<label>{{ label }}<slot /></label>' },
    UInput: true,
    UTextarea: true,
    USwitch: true,
    UIcon: true,
    ChatgptConnect: true,
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

describe('agent meta card', () => {
  it('shows the identity fields the operator came for', () => {
    const text = mount(AgentMetaCard, { props: { agent }, global }).text()
    expect(text).toContain('Agent-Details')
    expect(text).toContain('zaz@delta-mind.at')
    expect(text).toContain('chatty')
    expect(text).toContain('host-01KZ')
    expect(text).toContain('ssh-ed25519 AAAAC3Nz')
  })

  it('writes a dash where the nest has not reported a value yet', () => {
    const unsynced = { ...agent, hostname: null, hostId: null, pubkeySsh: null, firstSeenAt: null }
    const text = mount(AgentMetaCard, { props: { agent: unsynced }, global }).text()
    expect(text).not.toContain('chatty')
    expect(text.match(/—/g)?.length).toBeGreaterThanOrEqual(4)
  })
})

describe('agent runs card', () => {
  const run: Run = {
    id: 'run-1',
    agentEmail: agent.email,
    taskId: 'daily-summary',
    startedAt: 1_785_800_000,
    finishedAt: 1_785_800_042,
    status: 'ok',
    finalMessage: '3 Mails zusammengefasst.',
    stepCount: 4,
    trace: null,
  }

  it('says so instead of showing an empty list', () => {
    expect(mount(AgentRunsCard, { props: { runs: [] }, global }).text()).toContain('Noch keine Läufe.')
  })

  it('shows status, task, elapsed time and the final message', () => {
    const text = mount(AgentRunsCard, { props: { runs: [run] }, global }).text()
    expect(text).toContain('ok')
    expect(text).toContain('daily-summary')
    expect(text).toContain('42 s')
    expect(text).toContain('3 Mails zusammengefasst.')
  })

  it('leaves out the elapsed time while a run is still going', () => {
    const running: Run = { ...run, status: 'running', finishedAt: null, finalMessage: null }
    const text = mount(AgentRunsCard, { props: { runs: [running] }, global }).text()
    expect(text).toContain('läuft')
    expect(text).not.toContain('42 s')
  })

  it('folds the raw trace behind its own disclosure', () => {
    const traced: Run = { ...run, trace: { steps: ['mail.list'] } }
    const card = mount(AgentRunsCard, { props: { runs: [traced] }, global })
    expect(card.text()).toContain('Trace')
    expect(card.text()).toContain('mail.list')
    expect(mount(AgentRunsCard, { props: { runs: [run] }, global }).text()).not.toContain('Trace')
  })
})

describe('agent skills card', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    confirmDialog.mockReset()
    confirmDialog.mockReturnValue(true)
  })

  const skill = {
    agentEmail: agent.email,
    name: 'iurio',
    description: 'Wenn der User über IURIO spricht, lade das.',
    body: '# IURIO',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }

  async function mounted(rows: unknown[] = [skill]) {
    apiFetch.mockResolvedValue(rows)
    const card = mount(AgentSkillsCard, { props: { agentName: 'zaz' }, global })
    await flushPromises()
    return card
  }

  it('loads the catalog of the agent it was given', async () => {
    await mounted()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/skills')
  })

  it('lists name and description of every skill', async () => {
    const text = (await mounted()).text()
    expect(text).toContain('iurio')
    expect(text).toContain('Wenn der User über IURIO spricht, lade das.')
  })

  it('points at the default skills when the agent has none of its own', async () => {
    const text = (await mounted([])).text()
    expect(text).toContain('Noch keine eigenen Skills')
    expect(text).toContain('@openape/ape-agent')
  })

  it('marks a disabled skill', async () => {
    const text = (await mounted([{ ...skill, enabled: false }])).text()
    expect(text).toContain('deaktiviert')
  })

  it('surfaces a load failure instead of showing an empty catalog', async () => {
    apiFetch.mockRejectedValue({ data: { statusMessage: 'nest offline' } })
    const card = mount(AgentSkillsCard, { props: { agentName: 'zaz' }, global })
    await flushPromises()
    expect(card.text()).toContain('nest offline')
  })

  it('opens the editor on the clicked skill', async () => {
    const card = await mounted()
    await card.find('button[type="button"]').trigger('click')
    expect(card.text()).toContain('iurio bearbeiten')
  })

  it('asks before deleting and reloads afterwards', async () => {
    const card = await mounted()
    await card.findAll('button').at(-1)!.trigger('click')
    await flushPromises()
    expect(confirmDialog).toHaveBeenCalledOnce()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/skills/iurio', { method: 'DELETE' })
  })

  it('keeps the skill when the confirmation is declined', async () => {
    confirmDialog.mockReturnValue(false)
    const card = await mounted()
    apiFetch.mockClear()
    await card.findAll('button').at(-1)!.trigger('click')
    await flushPromises()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('agent secrets card', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    confirmDialog.mockReset()
    confirmDialog.mockReturnValue(true)
  })

  const active = { env: 'OPENAI_API_KEY', status: 'active' as const, created_at: 0, updated_at: 0, revoked_at: null }
  const revoked = { env: 'OLD_KEY', status: 'revoked' as const, created_at: 0, updated_at: 0, revoked_at: 1 }

  async function mounted(rows = [active]) {
    apiFetch.mockResolvedValue({ secrets: rows })
    const card = mount(AgentSecretsCard, { props: { agentName: 'zaz' }, global })
    await flushPromises()
    return card
  }

  it('loads the secrets of the agent it was given', async () => {
    await mounted()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/secrets')
  })

  it('lists env name and status, never a value', async () => {
    const text = (await mounted([active, revoked])).text()
    expect(text).toContain('OPENAI_API_KEY')
    expect(text).toContain('aktiv')
    expect(text).toContain('OLD_KEY')
    expect(text).toContain('widerrufen')
  })

  it('counts only the active ones in the badge', async () => {
    // The badge pill sits right behind the heading, so the two run together
    // in textContent: "Secrets" + the count.
    expect((await mounted([active, revoked])).text()).toContain('Secrets1')
    expect((await mounted([active, { ...active, env: 'RESEND_API_KEY' }])).text()).toContain('Secrets2')
  })

  it('offers the revoke button only for active secrets', async () => {
    const onlyRevoked = await mounted([revoked])
    expect(onlyRevoked.text()).not.toContain('Secret widerrufen')
    const withActive = await mounted([active])
    expect(withActive.text()).toContain('Secret widerrufen')
  })

  it('asks before revoking and reloads afterwards', async () => {
    const card = await mounted()
    const revokeButton = card.findAll('button').find(b => b.text().includes('Secret widerrufen'))!
    await revokeButton.trigger('click')
    await flushPromises()
    expect(confirmDialog).toHaveBeenCalledOnce()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/secrets/OPENAI_API_KEY', { method: 'DELETE' })
  })

  it('surfaces a revoke failure', async () => {
    const card = await mounted()
    apiFetch.mockRejectedValue({ message: 'sealed key missing' })
    const revokeButton = card.findAll('button').find(b => b.text().includes('Secret widerrufen'))!
    await revokeButton.trigger('click')
    await flushPromises()
    expect(card.text()).toContain('sealed key missing')
  })
})
