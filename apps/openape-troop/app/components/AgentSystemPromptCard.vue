<script setup lang="ts">
import type { Agent } from '../types/agent'
import { computed, ref, watch } from 'vue'

// Agent-level system prompt — applies to every chat message AND every cron task
// run. Tasks supply the user-prompt (what to do); chat supplies the user-message
// (the human's question). Saved on blur via PATCH /api/agents/[name]. The bridge
// daemon re-reads agent.json on every inbound chat message, and `apes agents run`
// reads it at run start, so edits propagate within one sync cycle (~5min)
// without restart.
//
// The draft re-seeds on two events, and it needs both: a freshly loaded agent
// (new object, e.g. after a reload) and a new authoritative prompt on the agent
// already shown. The second one is the recipe: applying it rewrites the prompt
// server-side and the page writes the result into the object it already holds,
// so the identity never changes. Watching only the identity left the operator's
// stale draft in the textarea, and the next save PATCHed it back over what the
// recipe had just written.
const props = defineProps<{ agentName: string, agent: Agent }>()
const emit = defineEmits<{ saved: [systemPrompt: string] }>()

const { t } = useI18n()

const draft = ref('')
const saving = ref(false)
const error = ref('')
const dirty = computed(() => draft.value !== (props.agent.systemPrompt ?? ''))

function seed() { draft.value = props.agent.systemPrompt ?? '' }
watch(() => props.agent, seed, { immediate: true })
watch(() => props.agent.systemPrompt, seed)

async function save() {
  if (!dirty.value) return
  saving.value = true
  error.value = ''
  try {
    await apiFetch(`/api/agents/${props.agentName}`, {
      method: 'PATCH',
      body: { system_prompt: draft.value },
    })
    emit('saved', draft.value)
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
          <UIcon name="i-lucide-message-square" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.systemPrompt.title') }}</span>
          <UBadge v-if="dirty" color="warning" variant="subtle" size="xs">
            {{ $t('common.badge.unsaved') }}
          </UBadge>
          <UBadge v-else-if="draft" color="success" variant="subtle" size="xs">
            {{ $t('common.badge.set') }}
          </UBadge>
          <UBadge v-else color="neutral" variant="subtle" size="xs">
            {{ $t('common.badge.empty') }}
          </UBadge>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="px-4 pb-4 pt-3 border-t border-(--ui-border)">
        <UTextarea
          v-model="draft"
          :rows="5"
          autoresize
          size="lg"
          class="w-full"
          :ui="{ base: 'w-full' }"
          :placeholder="$t('agentDetail.systemPrompt.placeholder')"
          @blur="save"
        />
        <p class="text-xs text-muted mt-2">
          {{ $t('agentDetail.systemPrompt.hint') }}
        </p>
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
