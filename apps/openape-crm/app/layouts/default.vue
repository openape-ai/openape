<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { apiFetch } from '../utils/api'

const { user } = useOpenApeAuth()
const { list, activeId, select } = useWorkspaces()
const route = useRoute()
const router = useRouter()
const { status: graphStatus, reload: reloadGraph, connect, disconnect } = useGraph()
const toast = useToast()
const unread = ref(0)

const pane = computed(() => {
  const path = route.path
  if (path.startsWith('/aufgaben')) return 'aufgaben'
  if (path.startsWith('/kalender')) return 'kalender'
  if (path.startsWith('/support')) return 'support'
  if (path.startsWith('/dateien')) return 'dateien'
  if (path.startsWith('/kontakte') || path.startsWith('/contacts')) return 'kontakte'
  if (path.startsWith('/katalog')) return 'katalog'
  if (path.startsWith('/workspace')) return 'workspace'
  return 'vorgaenge'
})

onMounted(() => void reloadGraph())
watch(() => route.query.graph, (flag) => {
  if (!flag) return
  if (flag === 'ok') toast.add({ title: 'Microsoft verbunden', color: 'success' })
  else if (flag === 'norefresh') toast.add({ title: 'Microsoft hat kein Refresh-Token geliefert', color: 'error' })
  else toast.add({ title: 'Microsoft-Verbindung abgebrochen', color: 'error' })
  void reloadGraph()
  const query = { ...route.query }
  delete query.graph
  void router.replace({ path: route.path, query })
}, { immediate: true })
watch(activeId, async (id) => {
  if (!id) {
    unread.value = 0
    return
  }
  try {
    const threads = await apiFetch<{ status: string }[]>(`/api/threads?workspace_id=${id}`)
    unread.value = threads.filter(t => t.status === 'neu').length
  }
  catch {
    unread.value = 0
  }
}, { immediate: true })

function openSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
}

async function onPick(hit: { deal_id?: string, phase?: string }) {
  if (!hit.deal_id) return
  await router.push({ path: '/vorgaenge', query: { phase: hit.phase || 'deal', id: hit.deal_id } })
}

const userItems = computed(() => [[
  {
    label: graphStatus.value.connected ? `Microsoft: ${graphStatus.value.mail}` : 'Microsoft verbinden',
    onSelect: () => graphStatus.value.connected ? disconnect() : connect(),
  },
  { label: 'Mitglieder', to: '/workspace' },
]])
</script>

<template>
  <div class="flex h-dvh overflow-hidden bg-[var(--crm-bg)] text-[var(--crm-ink)]">
    <AppRail v-if="user" :pane="pane" :unread="unread" @search="openSearch">
      <template #user>
        <USelect
          v-if="list.length > 1"
          :model-value="activeId"
          :items="list.map(w => ({ label: w.name, value: w.id }))"
          size="xs"
          class="w-[34px]"
          @update:model-value="select($event as string)"
        />
        <UDropdownMenu :items="userItems">
          <button
            type="button"
            class="grid size-[34px] place-items-center rounded-lg bg-[var(--crm-accent)] text-[11px] font-medium text-white"
            :title="user.sub"
          >
            {{ user.sub.slice(0, 2).toUpperCase() }}
          </button>
        </UDropdownMenu>
      </template>
    </AppRail>
    <div class="min-w-0 flex-1 overflow-hidden">
      <slot />
    </div>
    <CommandPalette :workspace-id="activeId" @pick="onPick" />
  </div>
</template>
