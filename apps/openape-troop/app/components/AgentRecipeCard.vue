<script setup lang="ts">
import type { Detail } from '../types/agent'
import { ref } from 'vue'

// Set / update the recipe on this existing agent (INT-4). Re-materializes
// <repo>@<ref> and applies its intent + toolset live (no respawn); the nest
// re-syncs within ~1s.
//
// Applying a recipe rewrites the agent's system prompt server-side, so the card
// re-reads the agent afterwards and hands the fresh prompt to the page via
// `applied`. The page owns `detail` and is the one that writes it back — that
// hand-off is the whole coupling between this card and the system-prompt card.
const props = defineProps<{ agentName: string }>()
const emit = defineEmits<{ applied: [systemPrompt: string] }>()

const { t } = useI18n()

const recipeRef = ref('')
const recipeParams = ref('{}')
const saving = ref(false)
const error = ref('')
const result = ref<{ ref: string, required_capabilities: string[] } | null>(null)

async function apply() {
  if (!recipeRef.value.trim()) return
  saving.value = true
  error.value = ''
  result.value = null
  try {
    let params: Record<string, unknown> = {}
    if (recipeParams.value.trim()) params = JSON.parse(recipeParams.value)
    const res = await apiFetch<{ ref: string, required_capabilities?: string[] }>(`/api/agents/${props.agentName}/recipe`, {
      method: 'POST',
      body: { repo_ref: recipeRef.value.trim(), params },
    })
    result.value = { ref: res.ref, required_capabilities: res.required_capabilities ?? [] }
    emit('applied', (await apiFetch<Detail>(`/api/agents/${props.agentName}`)).agent.systemPrompt)
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('agentDetail.recipe.error.applyFailed')
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
          <UIcon name="i-lucide-package" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.recipe.title') }}</span>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="px-4 pb-4 pt-3 border-t border-(--ui-border) space-y-3">
        <UFormField :label="$t('agentDetail.recipe.ref.label')" :description="$t('agentDetail.recipe.ref.description')">
          <UInput v-model="recipeRef" placeholder="openape-ai/coding-agent@main" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>
        <UFormField :label="$t('agentDetail.recipe.params.label')" :description="$t('agentDetail.recipe.params.description')">
          <UTextarea v-model="recipeParams" :rows="2" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>
        <UAlert v-if="error" color="error" :title="error" />
        <UAlert
          v-if="result"
          color="success"
          :title="$t('agentDetail.recipe.applied', { ref: result.ref })"
          :description="result.required_capabilities.length ? $t('agentDetail.recipe.bindSecrets', { names: result.required_capabilities.join(', ') }) : $t('agentDetail.recipe.noNewSecrets')"
        />
        <div class="flex justify-end">
          <UButton size="sm" color="primary" :loading="saving" :disabled="!recipeRef.trim()" @click="apply">
            {{ $t('agentDetail.recipe.applyButton') }}
          </UButton>
        </div>
      </div>
    </details>
  </UCard>
</template>
