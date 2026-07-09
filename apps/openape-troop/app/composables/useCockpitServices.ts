import { ref } from 'vue'

export interface CockpitService { id: string, baseUrl: string, tasksPath: string, label: string, enabled: boolean }

export function useCockpitServices() {
  const services = ref<CockpitService[]>([])
  const error = ref('')

  async function load(): Promise<void> {
    try { services.value = await $fetch<CockpitService[]>('/api/cockpit/services') }
    catch { error.value = 'Konnte Services nicht laden.' }
  }
  async function add(baseUrl: string, label?: string): Promise<void> {
    error.value = ''
    try {
      const s = await $fetch<CockpitService>('/api/cockpit/services', { method: 'POST', body: { baseUrl, label } })
      services.value.push(s)
    }
    catch (e) {
      error.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Ungültige URL.'
    }
  }
  async function remove(id: string): Promise<void> {
    await $fetch(`/api/cockpit/services/${id}`, { method: 'DELETE' })
    services.value = services.value.filter(s => s.id !== id)
  }
  async function toggle(s: CockpitService): Promise<void> {
    await $fetch(`/api/cockpit/services/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } })
    s.enabled = !s.enabled
  }
  return { services, error, load, add, remove, toggle }
}
