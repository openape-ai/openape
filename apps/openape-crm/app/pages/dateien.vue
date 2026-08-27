<script setup lang="ts">
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
    <header class="border-b border-[var(--crm-line)] px-5 py-3">
      <h1 class="text-[15px] font-semibold">
        Dateien
      </h1>
      <nav class="mt-1 flex flex-wrap gap-1 text-[12px] text-[var(--crm-ink-3)]">
        <button
          v-for="(crumb, i) in trail"
          :key="`${crumb.id}-${i}`"
          type="button"
          class="hover:text-[var(--crm-accent-2)]"
          @click="openFolder(crumb.id, crumb.name, i === 0)"
        >
          {{ crumb.name }}<span v-if="i < trail.length - 1"> /</span>
        </button>
      </nav>
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
      <template v-else-if="folder">
        <a v-if="folder.web_url" :href="folder.web_url" target="_blank" class="mb-3 inline-block text-sm text-[var(--crm-accent-2)]">
          In OneDrive öffnen
        </a>
        <ul class="mx-auto max-w-3xl divide-y divide-[var(--crm-line)] rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)]">
          <li v-for="child in folder.children" :key="child.id">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--crm-panel-2)]"
              @click="enter(child)"
            >
              <UIcon :name="child.folder ? 'i-lucide-folder' : 'i-lucide-file'" class="size-4 text-[var(--crm-ink-3)]" />
              <span class="min-w-0 flex-1 truncate">{{ child.name }}</span>
              <span v-if="!child.folder && child.size != null" class="text-[11px] text-[var(--crm-ink-3)]">
                {{ Math.round(child.size / 1024) }} KB
              </span>
            </button>
          </li>
          <li v-if="!loading && !folder.children.length" class="px-4 py-8 text-center text-[var(--crm-ink-3)]">
            Ordner ist leer.
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
