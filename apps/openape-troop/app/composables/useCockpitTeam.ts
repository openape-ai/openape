import { ref } from 'vue'

export interface TeamAgent {
  id: string
  role: string
  label: string
  duties: string
  tools: string[]
  reportsTo: string | null
  enabled: boolean
}

// The CEO's delegation team for one org — CRUD against /api/cockpit/orgs/:id/agents.
export function useCockpitTeam() {
  const team = ref<TeamAgent[]>([])
  const error = ref('')
  let orgId = ''

  async function load(id: string): Promise<void> {
    orgId = id
    error.value = ''
    if (!id) { team.value = []; return }
    try { team.value = await $fetch<TeamAgent[]>(`/api/cockpit/orgs/${id}/agents`) }
    catch { error.value = 'Konnte das Team nicht laden.' }
  }
  async function add(input: { label: string, role: string, duties: string, tools: string[] }): Promise<void> {
    error.value = ''
    try {
      const a = await $fetch<TeamAgent>(`/api/cockpit/orgs/${orgId}/agents`, { method: 'POST', body: input })
      team.value.push(a)
    }
    catch (e) { error.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Konnte nicht anlegen.' }
  }
  async function patch(a: TeamAgent, fields: Partial<Pick<TeamAgent, 'label' | 'role' | 'duties' | 'tools' | 'enabled'>>): Promise<void> {
    await $fetch(`/api/cockpit/orgs/${orgId}/agents/${a.id}`, { method: 'PATCH', body: fields })
    Object.assign(a, fields)
  }
  async function remove(id: string): Promise<void> {
    await $fetch(`/api/cockpit/orgs/${orgId}/agents/${id}`, { method: 'DELETE' })
    team.value = team.value.filter(a => a.id !== id)
  }
  return { team, error, load, add, patch, remove }
}
