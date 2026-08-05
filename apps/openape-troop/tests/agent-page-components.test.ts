// @vitest-environment happy-dom
import type { Agent, Task } from '../app/types/agent'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import AgentDangerZone from '../app/components/AgentDangerZone.vue'
import AgentHeader from '../app/components/AgentHeader.vue'
import AgentTasksCard from '../app/components/AgentTasksCard.vue'
import de from '../i18n/locales/de.json'

// The three pieces the agent page keeps around its cards: the sticky header
// (identity, nest badge, pause), the scheduled tasks with their editor, and the
// danger zone that destroys the agent. Assertions run against the shipped
// German catalog, so a renamed or missing key fails here.
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } })

vi.stubGlobal('useI18n', () => i18n.global)

const apiFetch = vi.fn()
vi.stubGlobal('apiFetch', apiFetch)

const navigateTo = vi.fn()
vi.stubGlobal('navigateTo', navigateTo)

const confirmDialog = vi.fn(() => true)
vi.stubGlobal('confirm', confirmDialog)

const global = {
  plugins: [i18n],
  stubs: {
    UCard: { template: '<div><slot /></div>' },
    UBadge: { template: '<span><slot /></span>' },
    UAlert: { props: ['title'], template: '<div class="alert">{{ title }}</div>' },
    UIcon: true,
    UButton: {
      props: ['disabled', 'title', 'icon'],
      template: '<button :disabled="disabled" :title="title" :data-icon="icon"><slot /></button>',
    },
    UModal: {
      props: ['open', 'title'],
      template: '<div v-if="open" class="modal"><h1>{{ title }}</h1><slot name="body" /><slot name="footer" /></div>',
    },
    UFormField: { props: ['label'], template: '<label>{{ label }}<slot /></label>' },
    UInput: {
      props: ['modelValue', 'placeholder'],
      template: '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)">',
    },
    UTextarea: {
      props: ['modelValue'],
      template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UCheckbox: { props: ['modelValue'], template: '<input type="checkbox" :checked="modelValue">' },
    CronInput: { props: ['modelValue'], template: '<span class="cron">{{ modelValue }}</span>' },
    ToolPicker: { props: ['modelValue'], template: '<span class="tools">{{ modelValue.join(",") }}</span>' },
    LocaleSwitcher: true,
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

const task: Task = {
  taskId: 'daily-summary',
  name: 'Daily Summary',
  cron: '0 7 * * *',
  userPrompt: 'Fasse meine Mails zusammen.',
  tools: ['mail.list', 'mail.read'],
  maxSteps: 12,
  enabled: true,
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find(b => b.text() === label)
}

describe('agent tasks card', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    confirmDialog.mockClear()
    confirmDialog.mockReturnValue(true)
  })

  function mounted(tasks: Task[] = [task]) {
    return mount(AgentTasksCard, { props: { agentName: 'zaz', tasks }, global })
  }

  it('shows the hint instead of a list when the agent has no tasks', () => {
    const card = mounted([])
    expect(card.text()).toContain('Noch keine Tasks')
    expect(card.findAll('li')).toHaveLength(0)
  })

  it('renders a task with its schedule, step budget and tool count', () => {
    const card = mounted()
    expect(card.text()).toContain('Daily Summary')
    expect(card.text()).toContain('0 7 * * *')
    expect(card.text()).toContain('max. 12 Schritte')
    expect(card.text()).toContain('2 Tools')
  })

  it('marks a disabled task', () => {
    const card = mounted([{ ...task, enabled: false }])
    expect(card.text()).toContain('deaktiviert')
  })

  it('opens the editor prefilled when a row is clicked', async () => {
    const card = mounted()
    await card.find('li button').trigger('click')
    expect(card.find('.modal').text()).toContain('daily-summary bearbeiten')
    expect(card.find('input').element.value).toBe('daily-summary')
    expect(card.find('.cron').text()).toBe('0 7 * * *')
    expect(card.find('.tools').text()).toBe('mail.list,mail.read')
  })

  it('creates a task and asks the page to reload', async () => {
    apiFetch.mockResolvedValue({})
    const card = mounted([])
    await button(card, 'Neuer Task')!.trigger('click')
    expect(card.find('.modal').text()).toContain('Neuer Task')

    await button(card, 'Task anlegen')!.trigger('click')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/tasks', expect.objectContaining({ method: 'POST' }))
    expect(card.emitted('updated')).toHaveLength(1)
    expect(card.find('.modal').exists()).toBe(false)
  })

  // The editor PUTs the editable fields only — task_id is the row's identity
  // and travels in the URL, never in the body.
  it('saves an edit without resending the task id', async () => {
    apiFetch.mockResolvedValue({})
    const card = mounted()
    await card.find('li button').trigger('click')
    await button(card, 'Änderungen speichern')!.trigger('click')
    await flushPromises()

    const [url, opts] = apiFetch.mock.calls[0]!
    expect(url).toBe('/api/agents/zaz/tasks/daily-summary')
    expect(opts.method).toBe('PUT')
    expect(opts.body).not.toHaveProperty('task_id')
    expect(opts.body.max_steps).toBe(12)
    expect(card.emitted('updated')).toHaveLength(1)
  })

  it('keeps the editor open and shows why when saving fails', async () => {
    apiFetch.mockRejectedValue({ data: { statusMessage: 'cron ist ungültig' } })
    const card = mounted()
    await card.find('li button').trigger('click')
    await button(card, 'Änderungen speichern')!.trigger('click')
    await flushPromises()

    expect(card.find('.alert').text()).toBe('cron ist ungültig')
    expect(card.find('.modal').exists()).toBe(true)
    expect(card.emitted('updated')).toBeUndefined()
  })

  it('deletes a task after confirmation and asks the page to reload', async () => {
    apiFetch.mockResolvedValue({})
    const card = mounted()
    await card.findAll('li button')[1]!.trigger('click')
    await flushPromises()

    expect(confirmDialog).toHaveBeenCalledOnce()
    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/tasks/daily-summary', { method: 'DELETE' })
    expect(card.emitted('updated')).toHaveLength(1)
  })

  it('deletes nothing when the confirmation is declined', async () => {
    confirmDialog.mockReturnValue(false)
    const card = mounted()
    await card.findAll('li button')[1]!.trigger('click')
    await flushPromises()

    expect(apiFetch).not.toHaveBeenCalled()
  })

  // A failed delete belongs in the page-level alert, not in the editor: the
  // editor is closed at that moment and would swallow the message.
  it('reports a failed delete upwards', async () => {
    apiFetch.mockRejectedValue({ message: 'nest offline' })
    const card = mounted()
    await card.findAll('li button')[1]!.trigger('click')
    await flushPromises()

    expect(card.emitted('error')).toEqual([['nest offline']])
    expect(card.emitted('updated')).toBeUndefined()
  })
})

describe('agent header', () => {
  beforeEach(() => { apiFetch.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  function mounted(a: Agent | null = agent) {
    return mount(AgentHeader, { props: { agentName: 'zaz', agent: a }, global })
  }

  it('shows the poll badge while no nest is connected', async () => {
    apiFetch.mockResolvedValue([])
    const header = mounted()
    await flushPromises()
    expect(header.text()).toContain('○ poll')
  })

  it('names the connected nests in the live badge', async () => {
    apiFetch.mockResolvedValue([{ hostname: 'chatty' }, { hostname: 'mini' }])
    const header = mounted()
    await flushPromises()
    expect(header.text()).toContain('● live')
    expect(header.find('[title="live · chatty, mini"]').exists()).toBe(true)
  })

  it('offers no identity and no pause switch before the agent has loaded', async () => {
    apiFetch.mockResolvedValue([])
    const header = mounted(null)
    await flushPromises()
    expect(header.text()).not.toContain('zaz')
    expect(button(header, 'Pausieren')).toBeUndefined()
  })

  it('pauses the agent and reports the new state upwards', async () => {
    apiFetch.mockResolvedValue([])
    const header = mounted()
    await flushPromises()
    await button(header, 'Pausieren')!.trigger('click')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/pause', { method: 'POST' })
    expect(header.emitted('update:paused')).toEqual([[true]])
  })

  it('resumes a paused agent and shows the badge while it is paused', async () => {
    apiFetch.mockResolvedValue([])
    const header = mounted({ ...agent, paused: true })
    await flushPromises()
    expect(header.text()).toContain('Pausiert')

    await button(header, 'Fortsetzen')!.trigger('click')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/agents/zaz/resume', { method: 'POST' })
    expect(header.emitted('update:paused')).toEqual([[false]])
  })

  it('reports a failed pause upwards instead of flipping the state', async () => {
    apiFetch.mockResolvedValueOnce([]).mockRejectedValueOnce({ message: 'nest offline' })
    const header = mounted()
    await flushPromises()
    await button(header, 'Pausieren')!.trigger('click')
    await flushPromises()

    expect(header.emitted('error')).toEqual([['nest offline']])
    expect(header.emitted('update:paused')).toBeUndefined()
  })

  // The badge polls every 30s for as long as the page is open — and stops when
  // it isn't. Without the cleanup the interval outlives the route change.
  it('stops polling the nest list once it is unmounted', async () => {
    vi.useFakeTimers()
    apiFetch.mockResolvedValue([])
    const header = mounted()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(apiFetch).toHaveBeenCalledTimes(2)

    header.unmount()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

describe('agent danger zone', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    navigateTo.mockClear()
  })
  afterEach(() => { vi.useRealTimers() })

  function mounted() {
    return mount(AgentDangerZone, { props: { agentName: 'zaz' }, global })
  }

  async function openModal(zone: ReturnType<typeof mount>) {
    await button(zone, 'Agent löschen')!.trigger('click')
  }

  it('keeps the destroy button disabled until the agent name is typed', async () => {
    const zone = mounted()
    await openModal(zone)
    const confirm = button(zone, 'Für immer löschen')!
    expect(confirm.attributes('disabled')).toBeDefined()

    await zone.find('.modal input').setValue('za')
    expect(button(zone, 'Für immer löschen')!.attributes('disabled')).toBeDefined()

    await zone.find('.modal input').setValue('zaz')
    expect(button(zone, 'Für immer löschen')!.attributes('disabled')).toBeUndefined()
  })

  it('polls the intent and leaves for the agent list once the nest is done', async () => {
    vi.useFakeTimers()
    apiFetch
      .mockResolvedValueOnce({ intent_id: 'int-1' })
      .mockResolvedValueOnce({ pending: true })
      .mockResolvedValueOnce({ ok: true })
    const zone = mounted()
    await openModal(zone)
    await zone.find('.modal input').setValue('zaz')
    await button(zone, 'Für immer löschen')!.trigger('click')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/agents/destroy-intent', { method: 'POST', body: { name: 'zaz' } })
    expect(zone.text()).toContain('Zerstörung läuft auf dem Nest…')

    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(navigateTo).toHaveBeenCalledWith('/agents')
  })

  it('shows the nest error instead of leaving the page', async () => {
    vi.useFakeTimers()
    apiFetch
      .mockResolvedValueOnce({ intent_id: 'int-1' })
      .mockResolvedValueOnce({ ok: false, error: 'root-Grant abgelehnt' })
    const zone = mounted()
    await openModal(zone)
    await zone.find('.modal input').setValue('zaz')
    await button(zone, 'Für immer löschen')!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)

    expect(zone.find('.alert').text()).toBe('root-Grant abgelehnt')
    expect(navigateTo).not.toHaveBeenCalled()
  })

  // A destroy that is still polling when the operator navigates away would keep
  // firing requests against a page that no longer exists.
  it('stops polling the destroy intent once it is unmounted', async () => {
    vi.useFakeTimers()
    apiFetch
      .mockResolvedValueOnce({ intent_id: 'int-1' })
      .mockResolvedValue({ pending: true })
    const zone = mounted()
    await openModal(zone)
    await zone.find('.modal input').setValue('zaz')
    await button(zone, 'Für immer löschen')!.trigger('click')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledTimes(1)

    zone.unmount()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})
