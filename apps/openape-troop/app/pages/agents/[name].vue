<script setup lang="ts">
import type { Detail } from '../../types/agent'
import { computed, onMounted, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

const route = useRoute()
const agentName = computed(() => String(route.params.name))

const { t } = useI18n()
useSeoMeta({ title: () => t('agentDetail.tabTitle', { name: agentName.value }) })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

const detail = ref<Detail | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await apiFetch(`/api/agents/${agentName.value}`)
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || t('agentDetail.error.loadFailed')
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
onMounted(() => { if (!user.value) navigateTo('/login') })

// The agent's system prompt has two writers: the operator typing in the
// system-prompt card, and the recipe card, whose apply rewrites the prompt
// server-side and reports the new value back. Both land here, on the one copy
// of the agent this page owns.
function adoptSystemPrompt(systemPrompt: string) {
  if (detail.value) detail.value.agent.systemPrompt = systemPrompt
}

function adoptTools(tools: string[]) {
  if (detail.value) detail.value.agent.tools = tools
}

function adoptPaused(paused: boolean) {
  if (detail.value) detail.value.agent.paused = paused
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AgentHeader
      :agent-name="agentName"
      :agent="detail?.agent ?? null"
      @update:paused="adoptPaused"
      @error="error = $event"
    />

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          {{ $t('common.loading') }}
        </p>
      </UCard>

      <template v-else-if="detail">
        <!-- Main Session — the ChatGPT-style chat surface. Patrick's
             request: "Im Agent tab wird die Main Session als tab
             (standard) angezeigt." It's the first thing the operator
             sees on this page; everything else (details, system prompt,
             tasks, skills) drops below as collapsed sections.
             Proxies through to chat.openape.ai for now (interim); the
             troop-native backend lands in M5/M6 of plan
             01KSWSHPA4C320VV0BKK98EZ0V. -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <AgentChat :agent-name="detail.agent.agentName" />
        </UCard>

        <AgentMetaCard :agent="detail.agent" />

        <AgentSystemPromptCard
          :agent-name="agentName"
          :agent="detail.agent"
          @saved="adoptSystemPrompt"
        />

        <AgentRecipeCard :agent-name="agentName" @applied="adoptSystemPrompt" />

        <AgentToolsCard
          :agent-name="agentName"
          :agent="detail.agent"
          @saved="adoptTools"
        />

        <AgentSkillsCard :agent-name="agentName" />

        <AgentSecretsCard :agent-name="agentName" />

        <AgentTasksCard
          :agent-name="agentName"
          :tasks="detail.tasks"
          @updated="load"
          @error="error = $event"
        />

        <AgentRunsCard :runs="detail.recentRuns" />
      </template>

      <AgentDangerZone :agent-name="agentName" />
    </main>
  </div>
</template>
