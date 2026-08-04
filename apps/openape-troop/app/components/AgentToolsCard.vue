<script setup lang="ts">
import type { Agent } from '../types/agent'
import { computed, ref, watch } from 'vue'

// Agent-level tool whitelist — controls which tools the chat-bridge exposes to
// the LLM during live thread turns. New agents start with all tools enabled;
// narrow as needed. Saved on toggle via PATCH /api/agents/[name] with
// `tools: string[]`; the bridge re-reads the list from agent.json on every new
// chat thread, so changes propagate within the next sync (~5min).
const props = defineProps<{ agentName: string, agent: Agent }>()
const emit = defineEmits<{ saved: [tools: string[]] }>()

const { t } = useI18n()

const draft = ref<string[]>([])
const saving = ref(false)
const error = ref('')
const dirty = computed(() => {
  const a = (props.agent.tools ?? []).toSorted()
  const b = draft.value.toSorted()
  return a.length !== b.length || a.some((v, i) => v !== b[i])
})

watch(() => props.agent, (a) => { draft.value = [...(a.tools ?? [])] }, { immediate: true })

async function save() {
  if (!dirty.value) return
  saving.value = true
  error.value = ''
  try {
    await apiFetch(`/api/agents/${props.agentName}`, {
      method: 'PATCH',
      body: { tools: draft.value },
    })
    emit('saved', [...draft.value])
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <details class="group">
      <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-wrench" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.tools.title') }}</span>
          <UBadge color="neutral" variant="subtle" size="xs">
            {{ $t('agentDetail.tools.selectedCount', { n: draft.length }) }}
          </UBadge>
          <UBadge v-if="dirty" color="warning" variant="subtle" size="xs">
            {{ $t('common.badge.unsaved') }}
          </UBadge>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="px-4 pb-4 pt-3 border-t border-(--ui-border)">
        <p class="text-xs text-muted mb-3">
          {{ $t('agentDetail.tools.hint') }}
        </p>
        <ToolPicker v-model="draft" :disabled="saving" />
        <UAlert v-if="error" color="error" :title="error" class="mt-3" />
        <div v-if="dirty" class="flex justify-end mt-3">
          <UButton size="sm" color="primary" :loading="saving" @click="save">
            {{ $t('common.save') }}
          </UButton>
        </div>
      </div>
    </details>
  </UCard>
</template>
