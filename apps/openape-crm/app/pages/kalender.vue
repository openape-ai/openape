<script setup lang="ts">
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface EventRow {
  id: string
  subject: string
  start: string | null
  end: string | null
  web_url: string | null
  join_url: string | null
  location: string | null
  organizer: string | null
}

const { user, fetchUser } = useOpenApeAuth()
const { status: graphStatus, reload: reloadGraph, connect } = useGraph()
const loading = ref(true)
const loadError = ref('')
const events = ref<EventRow[]>([])

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await reloadGraph()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Kalender konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(() => graphStatus.value.connected, (ok) => {
  if (ok) void reload()
})

async function reload() {
  if (!graphStatus.value.connected) {
    events.value = []
    return
  }
  events.value = await apiFetch('/api/graph/events')
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <header class="border-b border-[var(--crm-line)] px-5 py-3">
      <h1 class="text-[15px] font-semibold">
        Kalender
      </h1>
      <p class="text-[12px] text-[var(--crm-ink-3)]">
        Live aus Microsoft · nächste 60 Tage
      </p>
    </header>
    <div class="flex-1 overflow-auto p-4">
      <p v-if="loadError" class="text-sm text-[var(--crm-rose)]">
        {{ loadError }}
      </p>
      <p v-else-if="!graphStatus.connected" class="text-sm text-[var(--crm-ink-3)]">
        Microsoft verbinden, um den Kalender zu laden.
        <UButton size="xs" class="ms-2" @click="connect">
          Verbinden
        </UButton>
      </p>
      <ul v-else class="mx-auto max-w-2xl space-y-2">
        <li
          v-for="ev in events"
          :key="ev.id"
          class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)] px-4 py-3"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <b class="font-medium">{{ ev.subject }}</b>
              <div class="mt-1 text-[12px] text-[var(--crm-ink-3)]">
                <template v-if="ev.start">
                  {{ new Date(ev.start.endsWith('Z') ? ev.start : `${ev.start}Z`).toLocaleString('de-AT') }}
                </template>
                <template v-if="ev.location">
                  · {{ ev.location }}
                </template>
                <template v-if="ev.organizer">
                  · {{ ev.organizer }}
                </template>
              </div>
            </div>
            <a v-if="ev.join_url" :href="ev.join_url" target="_blank" class="text-sm text-[var(--crm-accent-2)]">Teams</a>
            <a v-if="ev.web_url" :href="ev.web_url" target="_blank" class="text-sm text-[var(--crm-ink-3)]">Outlook</a>
          </div>
        </li>
        <li v-if="!loading && !events.length" class="py-8 text-center text-[var(--crm-ink-3)]">
          Keine Termine in den nächsten 60 Tagen.
        </li>
      </ul>
    </div>
  </div>
</template>
