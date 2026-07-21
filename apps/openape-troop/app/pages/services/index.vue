<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

// Registered external sp-tasks services (e.g. zaz.delta-mind.at) that the reactive
// loop co-tends alongside the cockpit. Managed here in the control-plane.
useSeoMeta({ title: () => 'Services' })
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

const { services, error, load, add, remove, toggle } = useCockpitServices()
const url = ref('')
const label = ref('')
const adding = ref(false)
onMounted(() => { if (user.value) void load() })

async function onAdd() {
  const u = url.value.trim()
  if (!u) return
  adding.value = true
  await add(u, label.value.trim() || undefined)
  adding.value = false
  if (!error.value) { url.value = ''; label.value = '' }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="app-header">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl shrink-0" aria-hidden="true">🦍</span>
        <ViewToggle active="services" />
      </div>
      <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-log-out" @click="logout" />
    </header>

    <main class="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <h2 class="text-2xl font-bold mb-1">
        Services
      </h2>
      <p class="text-zinc-400 mb-6">
        Externe sp-tasks-Dienste (z.&nbsp;B. zaz.delta-mind.at), die dein reaktiver Loop zusätzlich zum Cockpit betreut — read-only unter deiner Identität.
      </p>

      <form class="flex flex-col sm:flex-row gap-2 mb-4" @submit.prevent="onAdd">
        <UInput v-model="url" type="url" placeholder="https://service.example.com" class="flex-1" :ui="{ base: 'w-full' }" />
        <UInput v-model="label" placeholder="Name (optional)" class="sm:w-48" :ui="{ base: 'w-full' }" />
        <UButton type="submit" color="primary" icon="i-lucide-plus" :loading="adding" :disabled="!url.trim()">
          Hinzufügen
        </UButton>
      </form>
      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

      <div v-if="services.length" class="space-y-2">
        <div v-for="s in services" :key="s.id" class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <USwitch :model-value="s.enabled" @update:model-value="toggle(s)" />
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">
              {{ s.label }}
            </div>
            <div class="text-xs text-zinc-500 font-mono truncate">
              {{ s.baseUrl }}{{ s.tasksPath }}
            </div>
          </div>
          <UButton color="error" variant="ghost" size="xs" icon="i-lucide-trash-2" @click="remove(s.id)" />
        </div>
      </div>
      <p v-else class="text-zinc-500 py-8 text-center">
        Noch keine Services. Trag oben den ersten ein.
      </p>
    </main>
  </div>
</template>
