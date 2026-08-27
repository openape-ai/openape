<script setup lang="ts">
import { formatBytes } from '#shared/calendar-view'
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface DriveChild {
  id: string
  name: string
  folder: boolean
  web_url: string | null
  size: number | null
  parent_id: string | null
}

interface DriveFolder {
  id: string
  name: string
  web_url: string | null
  parent_id: string | null
  children: DriveChild[]
}

const { user, fetchUser } = useOpenApeAuth()
const { status: graphStatus, reload: reloadGraph, connect } = useGraph()
const loading = ref(true)
const loadError = ref('')
const folder = ref<DriveFolder | null>(null)
const trail = ref<{ id: string | null, name: string }[]>([{ id: null, name: 'OneDrive' }])
const search = ref('')

const rows = computed(() => {
  const children = folder.value?.children ?? []
  const q = search.value.trim().toLowerCase()
  const filtered = q ? children.filter(c => c.name.toLowerCase().includes(q)) : children
  return [...filtered].sort((a, b) => {
    if (a.folder !== b.folder) return a.folder ? -1 : 1
    return a.name.localeCompare(b.name, 'de')
  })
})

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await reloadGraph()
    await openFolder(null, 'OneDrive', true)
  }
  catch (error) {
    loadError.value = problemMessage(error, 'OneDrive konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(() => graphStatus.value.connected, (ok) => {
  if (ok) void openFolder(null, 'OneDrive', true)
})

async function openFolder(id: string | null, name: string, reset = false) {
  if (!graphStatus.value.connected) {
    folder.value = null
    return
  }
  const q = id ? `?item_id=${encodeURIComponent(id)}` : ''
  folder.value = await apiFetch(`/api/graph/drive${q}`)
  search.value = ''
  if (reset) {
    trail.value = [{ id: null, name: 'OneDrive' }]
  }
  else {
    const idx = trail.value.findIndex(t => t.id === id)
    trail.value = idx >= 0 ? trail.value.slice(0, idx + 1) : [...trail.value, { id, name }]
  }
}

async function enter(child: DriveChild) {
  if (child.folder) {
    await openFolder(child.id, child.name)
  }
  else if (child.web_url) {
    window.open(child.web_url, '_blank')
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <header class="space-y-2 border-b border-[var(--crm-line)] px-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <nav class="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button
            v-for="(crumb, i) in trail"
            :key="`${crumb.id}-${i}`"
            type="button"
            class="rounded px-1 hover:text-[var(--crm-accent-2)]"
            :class="i === trail.length - 1 ? 'font-medium text-[var(--crm-ink)]' : 'text-[var(--crm-ink-3)]'"
            @click="openFolder(crumb.id, crumb.name, i === 0)"
          >
            {{ crumb.name }}<span v-if="i < trail.length - 1" class="ms-1 text-[var(--crm-ink-3)]">/</span>
          </button>
        </nav>
        <div class="flex items-center gap-2">
          <UInput v-model="search" icon="i-lucide-search" size="sm" placeholder="In diesem Ordner filtern" class="w-48 sm:w-56" />
          <UButton
            v-if="folder?.web_url"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-external-link"
            :href="folder.web_url"
            target="_blank"
          >
            OneDrive
          </UButton>
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-auto p-4">
      <p v-if="loadError" class="text-sm text-[var(--crm-rose)]">
        {{ loadError }}
      </p>
      <p v-else-if="!graphStatus.connected" class="text-sm text-[var(--crm-ink-3)]">
        Microsoft verbinden, um OneDrive zu öffnen.
        <UButton size="xs" class="ms-2" @click="connect">
          Verbinden
        </UButton>
      </p>
      <template v-else>
        <div v-if="!loading && !rows.length" class="py-16 text-center text-[var(--crm-ink-3)]">
          <UIcon :name="search ? 'i-lucide-search-x' : 'i-lucide-folder-open'" class="mx-auto mb-2 size-8 opacity-50" />
          <p>{{ search ? 'Nichts passt zum Filter.' : 'Ordner ist leer.' }}</p>
        </div>

        <ul v-if="rows.length" class="divide-y divide-[var(--crm-line)] sm:hidden">
          <li v-for="child in rows" :key="child.id">
            <button type="button" class="flex w-full items-center gap-3 py-3 text-left" @click="enter(child)">
              <UIcon
                :name="child.folder ? 'i-lucide-folder' : 'i-lucide-file'"
                class="size-5 shrink-0"
                :class="child.folder ? 'text-[var(--crm-accent-2)]' : 'text-[var(--crm-ink-3)]'"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ child.name }}</span>
                <span v-if="!child.folder" class="block text-xs text-[var(--crm-ink-3)]">{{ formatBytes(child.size) }}</span>
              </span>
              <UIcon v-if="child.folder" name="i-lucide-chevron-right" class="size-4 shrink-0 text-[var(--crm-ink-3)]" />
            </button>
          </li>
        </ul>

        <table v-if="rows.length" class="hidden w-full text-sm sm:table">
          <thead>
            <tr class="border-b border-[var(--crm-line)] text-left text-[11px] uppercase tracking-wide text-[var(--crm-ink-3)]">
              <th class="py-2 font-medium">
                Name
              </th>
              <th class="w-28 py-2 font-medium">
                Größe
              </th>
              <th class="w-24 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="child in rows"
              :key="child.id"
              class="border-b border-[var(--crm-line)]/60 hover:bg-[var(--crm-panel-2)]"
            >
              <td class="py-2.5">
                <button type="button" class="flex items-center gap-2 text-left" @click="enter(child)">
                  <UIcon
                    :name="child.folder ? 'i-lucide-folder' : 'i-lucide-file'"
                    class="size-4"
                    :class="child.folder ? 'text-[var(--crm-accent-2)]' : 'text-[var(--crm-ink-3)]'"
                  />
                  <span :class="child.folder ? 'font-medium' : undefined">{{ child.name }}</span>
                </button>
              </td>
              <td class="text-[var(--crm-ink-3)]">
                {{ child.folder ? '—' : formatBytes(child.size) }}
              </td>
              <td class="text-right">
                <UButton
                  v-if="!child.folder && child.web_url"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-external-link"
                  :href="child.web_url"
                  target="_blank"
                  aria-label="Öffnen"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>
