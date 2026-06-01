<script setup lang="ts">
import { computed } from 'vue'

const emit = defineEmits<{ retry: [] }>()
const open = defineModel<boolean>('open', { default: false })
const config = useRuntimeConfig()

// Pre-built CLI command the Owner copy-pastes into their terminal.
// Until id.openape.ai ships a browser consent screen for delegation
// requests (M4γ), this is the bootstrap path: Owner runs `apes grants
// delegate` once from a terminal where they're logged in via
// `apes login`. The IdP auto-approves (Owner is delegator + requester),
// stores the standing grant, and the next "Spawn agent" click finds
// it via the browser fetch in chart's onSpawnAgent.
const cliCommand = computed(() => {
  return `apes grants delegate --to org.openape.ai --at troop.openape.ai --scopes troop:spawn-agent --approval always`
})

const troopUiBase = computed(() => (config.public as { troopUiBase?: string }).troopUiBase ?? 'https://troop.openape.ai')

function copy(s: string) {
  try { navigator.clipboard.writeText(s) }
  catch { /* clipboard blocked */ }
}

function onRetry() {
  emit('retry')
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-md max-h-[92dvh] flex flex-col' }">
    <template #content>
      <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              {{ $t('bootstrapGrant.title') }}
            </h3>
            <p class="text-xs text-muted mt-1">
              {{ $t('bootstrapGrant.subtitle') }}
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="open = false" />
        </div>

        <div class="space-y-3">
          <div class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            {{ $t('bootstrapGrant.oneTime') }}
          </div>

          <div>
            <p class="text-xs font-medium uppercase tracking-wide text-muted mb-1">
              {{ $t('bootstrapGrant.step1.title') }}
            </p>
            <p class="text-xs text-muted mb-2">
              {{ $t('bootstrapGrant.step1.description') }}
            </p>
            <div class="flex items-stretch gap-2">
              <code class="flex-1 px-3 py-2 rounded-md bg-(--ui-bg-elevated) text-xs font-mono break-all">{{ cliCommand }}</code>
              <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-copy" :title="$t('common.copy')" @click="copy(cliCommand)" />
            </div>
          </div>

          <div>
            <p class="text-xs font-medium uppercase tracking-wide text-muted mb-1">
              {{ $t('bootstrapGrant.step2.title') }}
            </p>
            <p class="text-xs text-muted">
              {{ $t('bootstrapGrant.step2.description') }}
            </p>
          </div>

          <div>
            <p class="text-xs font-medium uppercase tracking-wide text-muted mb-1">
              {{ $t('bootstrapGrant.step3.title') }}
            </p>
            <p class="text-xs text-muted">
              {{ $t('bootstrapGrant.step3.description', { troopUi: troopUiBase }) }}
            </p>
          </div>
        </div>
      </div>

      <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <UButton variant="ghost" @click="open = false">
          {{ $t('common.cancel') }}
        </UButton>
        <UButton color="primary" icon="i-lucide-refresh-cw" @click="onRetry">
          {{ $t('bootstrapGrant.retry') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
